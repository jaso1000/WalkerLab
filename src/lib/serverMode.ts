// Optional "server mode" for the native apps (phone + TV): instead of keeping
// every service's URL/API key on the device and calling services directly
// (standalone, the default), the app logs into the user's own WalkerLab
// Docker server (server/) and behaves exactly like the web build - profiles,
// service configs, section names, wheels etc. come from the server's config
// routes, and every service call goes through its proxy, so API keys never
// reach the device. The data-path modules (storage.ts, profiles.ts, the API
// clients...) branch on `usesServer()` below instead of `Platform.OS ===
// 'web'`; purely visual web checks (sidebar, switches) stay on Platform.OS.
//
// What's kept on the device: the server URL, the session id the login
// returned (replayed as `Authorization: Bearer`, see server/src/auth.ts) and
// an image token (see server/src/auth.ts's imageTokenFor - `<Image>` URLs
// can't carry a header, and putting the full session id in a URL would leak
// a credential that can do anything). All three live in expo-secure-store.
// Standalone data is never touched by server mode, so disconnecting brings
// the device's own profiles back exactly as they were.
//
// Module state rather than React state: `usesServer()` is read synchronously
// from plain functions all over src/lib and src/api. `loadServerSession()`
// must have resolved before any of them run - AuthGate (phone) /
// TvServerGate (TV) render nothing else until it has, and the background
// notification task awaits it itself.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Present = the app is in server mode. `sessionId`/`imageToken` are absent
// while logged out (the user logged out, or the server answered 401): the
// app then shows the login form for `url` instead of quietly falling back to
// the device's standalone profiles. Only "Use standalone" (disconnectServer)
// removes the record.
export interface ServerSession {
  url: string;
  username: string;
  sessionId?: string;
  imageToken?: string;
}

const SESSION_KEY = 'walkerlab_server_session';
// The last server/username used, kept after a disconnect so the connect form
// can be pre-filled - never holds a credential.
const LAST_SERVER_KEY = 'walkerlab_last_server';

let session: ServerSession | null = null;
let loadPromise: Promise<void> | null = null;

export type ServerModeEvent = 'connected' | 'disconnected' | 'logged-out';
const listeners = new Set<(event: ServerModeEvent) => void>();

export function onServerModeChange(listener: (event: ServerModeEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ServerModeEvent) {
  listeners.forEach((l) => l(event));
}

export function loadServerSession(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  loadPromise ??= SecureStore.getItemAsync(SESSION_KEY)
    .then((raw) => {
      session = raw ? (JSON.parse(raw) as ServerSession) : null;
    })
    .catch(() => {
      session = null;
    });
  return loadPromise;
}

/** True on web and in native server mode: data comes from the WalkerLab server, service calls go through its proxy. */
export function usesServer(): boolean {
  return Platform.OS === 'web' || session !== null;
}

/** Native app connected to a WalkerLab server (never true on web). */
export function isNativeServerMode(): boolean {
  return Platform.OS !== 'web' && session !== null;
}

export function getServerSession(): ServerSession | null {
  return session;
}

/** Absolute URL for a server API path on native; the same-origin path on web. */
export function serverUrl(path: string): string {
  if (Platform.OS === 'web' || !session) return path;
  return session.url + path;
}

/** The Bearer header native server mode authenticates with; empty on web (the session cookie does it). */
export function serverAuthHeaders(): Record<string, string> {
  if (Platform.OS === 'web' || !session?.sessionId) return {};
  return { Authorization: `Bearer ${session.sessionId}` };
}

/**
 * URL for a server GET route an `<Image>` points at directly (the image proxy). On web it's same-origin
 * and the cookie authenticates it; on native it carries the image token, which the server accepts on the
 * image proxy only.
 */
export function serverImageUrl(path: string, params: Record<string, string>): string | undefined {
  let url: URL;
  if (Platform.OS === 'web') {
    url = new URL(path, window.location.origin);
  } else {
    if (!session?.imageToken) return undefined;
    url = new URL(session.url + path);
    url.searchParams.set('token', session.imageToken);
  }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

// In-memory first, so a burst of parallel 401s only reports the expiry once.
async function persist(next: ServerSession | null) {
  session = next;
  loadPromise = Promise.resolve();
  if (next) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function revoke(current: ServerSession) {
  if (!current.sessionId) return;
  await fetch(`${current.url}/api/auth/logout`, { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${current.sessionId}` } }).catch(() => {});
}

/** Called by apiFetch on a 401 in native server mode: the session was revoked or expired - back to the login form. */
export function reportSessionExpired() {
  if (!isNativeServerMode() || !session?.sessionId) return;
  persist({ url: session.url, username: session.username })
    .catch(() => {})
    .finally(() => emit('logged-out'));
}

/** Accepts `server:3300`, `http://192.168.1.50:3000/`, `https://walkerlab.example.com` etc. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    // A bare LAN address (IP, single-label host or explicit port) is almost always plain HTTP; a
    // public hostname (the Cloudflare tunnel) is HTTPS.
    const host = url.split('/')[0];
    const lan = /^(\d+\.){3}\d+(:\d+)?$/.test(host) || !host.includes('.') || /:\d+$/.test(host);
    url = `${lan ? 'http' : 'https'}://${url}`;
  }
  return url.replace(/\/api$/, '');
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body?.error === 'string' ? body.error : fallback;
}

/** Logs into the WalkerLab server and switches the app to server mode. Throws a user-readable message on failure. */
export async function connectServer(rawUrl: string, username: string, password: string): Promise<ServerSession> {
  const url = normalizeServerUrl(rawUrl);
  let res: Response;
  try {
    res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
  } catch {
    throw new Error(`Couldn't reach ${url}. Check the address and that this device can reach it.`);
  }
  if (res.status === 409) throw new Error('This server has no account yet. Open it in a browser first to create the admin account.');
  if (res.status === 404) throw new Error(`${url} doesn't look like a WalkerLab server.`);
  if (!res.ok) throw new Error(await readError(res, `Login failed (${res.status}).`));
  const body = (await res.json().catch(() => null)) as { username?: string; sessionId?: string; imageToken?: string } | null;
  if (!body?.sessionId || !body.imageToken) {
    throw new Error('This WalkerLab server is too old for the app to connect to. Update the Docker container first.');
  }

  const next: ServerSession = { url, sessionId: body.sessionId, imageToken: body.imageToken, username: body.username ?? username.trim() };
  await SecureStore.setItemAsync(LAST_SERVER_KEY, JSON.stringify({ url, username: next.username }));
  await persist(next);
  emit('connected');
  return next;
}

/** Logs out of the server but stays in server mode: the app shows the login form for the same server. */
export async function logoutServer(): Promise<void> {
  const current = session;
  if (!current) return;
  await revoke(current);
  await persist({ url: current.url, username: current.username });
  emit('logged-out');
}

/** Signs this device out of the server (best effort) and goes back to standalone, where the device's own profiles are untouched. */
export async function disconnectServer(): Promise<void> {
  const current = session;
  if (current) await revoke(current);
  await persist(null);
  emit('disconnected');
}

/** Pre-fill for the connect form: the last server address and username used on this device. */
export async function getLastServer(): Promise<{ url: string; username: string } | null> {
  if (Platform.OS === 'web') return null;
  const raw = await SecureStore.getItemAsync(LAST_SERVER_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as { url: string; username: string }) : null;
}

export type ServerSessionCheck =
  | { state: 'authenticated'; username: string; role: 'admin' | 'user' }
  | { state: 'needs-login' }
  | { state: 'unreachable'; message: string };

/** Asks the server whether the stored session is still valid (run on launch in server mode). */
export async function checkServerSession(): Promise<ServerSessionCheck> {
  if (!session?.sessionId) return { state: 'needs-login' };
  try {
    const res = await fetch(serverUrl('/api/auth/session'), { credentials: 'omit', headers: serverAuthHeaders() });
    if (!res.ok) return { state: 'unreachable', message: `The server answered ${res.status}.` };
    const body = await res.json();
    if (body.state === 'authenticated') return { state: 'authenticated', username: body.username, role: body.role };
    // The stored session is no longer valid (expired, revoked from another device, user deleted).
    await persist({ url: session.url, username: session.username });
    return { state: 'needs-login' };
  } catch {
    return { state: 'unreachable', message: `Couldn't reach ${session.url}.` };
  }
}
