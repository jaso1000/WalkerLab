// Thin JSON-fetch helper for calls to this app's own Node backend (server/).
// On web it's always same-origin (the backend serves the web build itself)
// and sends the session cookie. In native server mode (src/lib/serverMode.ts)
// it goes to the configured server URL with the stored session as a Bearer
// header, and a 401 there sends the app back to the login form. Only ever
// reached from `usesServer()` code paths - standalone native never calls it.
import { Platform } from 'react-native';
import { reportSessionExpired, serverAuthHeaders, serverUrl } from './serverMode';

export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(serverUrl(path), {
    method: options.method ?? 'GET',
    // Native authenticates with the Bearer header only - not React Native's
    // own cookie jar, which would otherwise pick up the login's cookie.
    credentials: Platform.OS === 'web' ? 'include' : 'omit',
    headers: {
      ...serverAuthHeaders(),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    // Only the server's own session check marks a 401 with WWW-Authenticate (server/src/auth.ts) -
    // other 401s, like change-password's wrong current password, aren't a lost session.
    if (res.status === 401 && res.headers.get('www-authenticate')) reportSessionExpired();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed: ${res.status}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
