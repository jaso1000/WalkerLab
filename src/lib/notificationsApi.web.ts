// Web's push-notification API - this app's own `server/` (the Docker/web
// deployment) is always a hosted, reachable server by definition, so web
// keeps real push delivery: VAPID + a service worker + PushSubscription,
// relayed through server/'s own webhook receiver. This is now web-only
// (native switched to fully local polling - see src/lib/
// notificationPolling.ts - since a phone can't receive an inbound webhook
// and nobody wanted to host a relay for it), so this module no longer
// needs to mirror any shared native interface - it's imported only from
// app/settings/notifications.web.tsx.
//
// expo-notifications' own web support assumes a VAPID key baked in at
// build time via app.json, which doesn't fit this app's self-hosted-per-
// instance model (every Docker install is its own origin with its own
// VAPID identity - see server/src/store.ts's getOrCreateVapidKeys()), so
// this hand-rolls the browser Push API directly instead of using it.
import { apiFetch } from './backendApi';
import { ServiceName } from '../api/types';

const SERVICE_WORKER_PATH = '/notification-sw.js';

export interface NotificationConnection {
  serverUrl: string;
  username: string;
  role?: 'admin' | 'user';
}

export interface NotificationPrefsResponse {
  prefs: Partial<Record<ServiceName, boolean>>;
  webhookUrls: Partial<Record<ServiceName, string>>;
}

// The address Sonarr/Radarr/Lidarr/Overseerr use to reach this WalkerLab
// server directly - one explicit value the admin sets, used for every
// service's webhook URL uniformly (see server/src/types.ts's identical
// WebhookCallback for the full rationale - this is never inferred from
// whatever domain the browser happened to be using).
export interface WebhookCallback {
  scheme: 'http' | 'https';
  host: string;
  port: number;
}

// Independent of push-subscription state (unlike getConnection() below,
// which is only meaningful once this browser has actually subscribed) -
// needed to gate the webhook-callback address field, which has to be
// editable *before* anyone has subscribed to anything (it's the first
// step of setup, not something that happens after).
export async function getSessionRole(): Promise<'admin' | 'user' | undefined> {
  const session = await apiFetch<{ state: string; role?: 'admin' | 'user' }>('/api/auth/session').catch(() => undefined);
  return session?.role;
}

export type RegisterResult = 'registered' | 'permission-denied' | 'not-connected';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

// https://github.com/web-push-libs/web-push#using-vapid-key-for-applicationserverkey
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getActiveSubscription(): Promise<PushSubscription | undefined> {
  if (!isPushSupported()) return undefined;
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH).catch(() => undefined);
  return (await registration?.pushManager.getSubscription().catch(() => undefined)) ?? undefined;
}

// Non-null only once this browser actually has an active push subscription
// registered - reflects "is push enabled here," not "is this browser
// logged in" (those are different questions on web, unlike native where
// they're the same thing).
export async function getConnection(): Promise<NotificationConnection | null> {
  const subscription = await getActiveSubscription();
  if (!subscription) return null;
  const session = await apiFetch<{ state: string; username?: string; role?: 'admin' | 'user' }>('/api/auth/session').catch(() => undefined);
  return { serverUrl: window.location.origin, username: session?.username ?? '', role: session?.role };
}

export function getPrefs(profileId: string): Promise<NotificationPrefsResponse> {
  return apiFetch(`/api/notifications/prefs/${encodeURIComponent(profileId)}`);
}

export function setPrefs(profileId: string, prefs: Partial<Record<ServiceName, boolean>>): Promise<NotificationPrefsResponse> {
  return apiFetch(`/api/notifications/prefs/${encodeURIComponent(profileId)}`, { method: 'PUT', body: prefs });
}

export function sendTest(profileId: string): Promise<void> {
  return apiFetch(`/api/notifications/test/${encodeURIComponent(profileId)}`, { method: 'POST' });
}

export function getWebhookCallback(): Promise<WebhookCallback | null> {
  return apiFetch('/api/notifications/webhook-callback');
}

export function setWebhookCallback(callback: WebhookCallback): Promise<WebhookCallback> {
  return apiFetch('/api/notifications/webhook-callback', { method: 'PUT', body: callback });
}

// Unsubscribes this browser locally. No server-side "forget me" call is
// needed beyond that - a dropped subscription just stops receiving pushes.
export async function disableNotifications(): Promise<void> {
  const subscription = await getActiveSubscription();
  if (subscription) await subscription.unsubscribe();
}

// Requests Notification permission (must be called from a real click - see
// app/settings/notifications.tsx, this is only ever wired to a direct
// onPress, never fired automatically on mount, since browsers block/ignore
// permission prompts not triggered by a user gesture), registers the
// service worker, fetches this server's VAPID public key, subscribes, and
// registers the subscription with the server.
export async function registerForPushNotificationsAsync(profileId: string): Promise<RegisterResult> {
  if (!isPushSupported()) return 'not-connected';
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return 'permission-denied';
  }
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  await navigator.serviceWorker.ready;
  const { publicKey } = await apiFetch<{ publicKey: string }>('/api/notifications/vapid-public-key');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = subscription.toJSON();
  await apiFetch('/api/notifications/register-device', {
    method: 'POST',
    body: { subscription: { endpoint: json.endpoint, keys: json.keys }, profileId },
  });
  return 'registered';
}
