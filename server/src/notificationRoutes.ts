// Push notification relay: device registration, per-service prefs, and the
// webhook receiver Sonarr/Radarr/Lidarr/Overseerr actually call. Split into
// two routers deliberately, not one - `notificationRouter` (mounted at
// /api/notifications with requireAuth in index.ts) and
// `notificationWebhookRouter` (mounted at /api/webhooks, NOT authenticated,
// since Sonarr/Radarr/etc. have no way to present a session cookie or
// Bearer header). They can't share a path prefix: Express applies
// app.use()'s middleware to any request matching that prefix regardless of
// whether a route inside the router actually matches, so a
// /api/notifications/webhook/... sub-path mounted under the same
// requireAuth'd prefix would still 401 before ever reaching the webhook
// logic. The secret embedded in the webhook URL itself is the only auth it
// gets (see getOrCreateNotificationWebhookSecret in store.ts).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import webpush from 'web-push';
import { requireAdmin } from './auth';
import { parseNotificationPayload } from './services/notificationPayloads';
import {
  getNotificationPrefs,
  getNotificationWebhookSecret,
  getOrCreateNotificationWebhookSecret,
  getOrCreateVapidKeys,
  getPushDevices,
  getWebhookCallback,
  registerPushDevice,
  setNotificationPrefs,
  setWebhookCallback,
} from './store';
import { isServiceName, ServiceName, VapidKeys, WebhookCallback } from './types';

export const notificationRouter = Router();
export const notificationWebhookRouter = Router();

// Lazily generates (once, on first need) and configures this instance's own
// VAPID identity - can't happen at module load, since store.ts's data isn't
// loaded until initStore() runs in index.ts's main(), which happens after
// this file's imports are evaluated. Idempotent past the first call.
let vapidConfigured = false;
function ensureVapidConfigured(): VapidKeys {
  const keys = getOrCreateVapidKeys();
  if (!vapidConfigured) {
    webpush.setVapidDetails('mailto:walkerlab@localhost', keys.publicKey, keys.privateKey);
    vapidConfigured = true;
  }
  return keys;
}

// The webhook URL's host+scheme+port comes from this instance's own
// explicitly-configured WebhookCallback (Settings > Push Notifications),
// never from the request that happened to be asking (i.e. never
// req.get('host')) - Sonarr/Radarr/Lidarr/Overseerr typically live on the
// same LAN as this server, and deriving the callback host from whatever
// domain a browser tab happened to be using at the time (which could be a
// public tunnel domain) would send that domain out to every configured
// *arr service, an unwanted leak the user explicitly flagged. One address
// used for every service uniformly - see WebhookCallback's own comment in
// types.ts for why that's simpler than deriving per-service.
function webhookUrl(userId: string, profileId: string, service: ServiceName, secret: string): string | undefined {
  const callback = getWebhookCallback();
  if (!callback) return undefined;
  return `${callback.scheme}://${callback.host}:${callback.port}/api/webhooks/${userId}/${profileId}/${service}/${secret}`;
}

// Every service currently in `notificationPrefs` with a truthy value gets
// its webhook secret resolved (generated on first look if missing) so the
// response can show a real, pasteable URL for each one already enabled -
// omitted (not present in the returned object) for a service whose URL
// can't be built yet (the webhook callback address hasn't been set - see
// webhookUrl() above).
function buildWebhookUrls(userId: string, profileId: string, prefs: Partial<Record<ServiceName, boolean>>): Partial<Record<ServiceName, string>> {
  const urls: Partial<Record<ServiceName, string>> = {};
  for (const [service, enabled] of Object.entries(prefs) as [ServiceName, boolean][]) {
    if (!enabled) continue;
    const secret = getOrCreateNotificationWebhookSecret(userId, profileId, service);
    const url = webhookUrl(userId, profileId, service, secret);
    if (url) urls[service] = url;
  }
  return urls;
}

// Web push only - native switched to fully local polling (see src/lib/
// notificationPolling.ts), so there's nothing to relay to it here anymore.
async function sendToUser(userId: string, title: string, body: string): Promise<number> {
  const devices = getPushDevices(userId);
  if (devices.length === 0) return 0;
  ensureVapidConfigured();
  const payload = JSON.stringify({ title, body });
  // Fire-and-forget - a dead/expired subscription (browser uninstalled,
  // permission revoked, etc.) just fails silently for that one device
  // rather than blocking the others.
  await Promise.all(
    devices.map((d) =>
      webpush.sendNotification(d.subscription, payload).catch((e) => {
        console.error('[notifications] Web push send failed:', e);
      })
    )
  );
  return devices.length;
}

notificationRouter.post('/register-device', (req, res) => {
  const { subscription, profileId } = (req.body ?? {}) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    profileId?: string;
  };
  if (typeof profileId !== 'string' || !profileId) {
    res.status(400).json({ error: 'profileId is required.' });
    return;
  }
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: 'subscription is required.' });
    return;
  }
  registerPushDevice(req.userId!, {
    subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
    profileId,
  });
  res.json({ ok: true });
});

notificationRouter.get('/vapid-public-key', (_req, res) => {
  const keys = ensureVapidConfigured();
  res.json({ publicKey: keys.publicKey });
});

// Any authenticated user can read this (the settings screen needs it to
// show the current value), but only an admin can change it - it's a fact
// about the whole deployment's network reachability, not a per-account
// preference, and a wrong value silently breaks webhook auto-setup for
// every user on this instance.
notificationRouter.get('/webhook-callback', (_req, res) => {
  res.json(getWebhookCallback());
});

notificationRouter.put('/webhook-callback', requireAdmin, (req, res) => {
  const { scheme, host, port } = (req.body ?? {}) as { scheme?: string; host?: string; port?: number };
  if (
    (scheme !== 'http' && scheme !== 'https') ||
    typeof host !== 'string' ||
    !host.trim() ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    res.status(400).json({ error: 'scheme must be "http" or "https", host is required, and port must be a valid port number.' });
    return;
  }
  const callback: WebhookCallback = { scheme, host: host.trim(), port };
  setWebhookCallback(callback);
  res.json(callback);
});

notificationRouter.get('/prefs/:profileId', (req, res) => {
  const prefs = getNotificationPrefs(req.userId!, req.params.profileId);
  res.json({ prefs, webhookUrls: buildWebhookUrls(req.userId!, req.params.profileId, prefs) });
});

notificationRouter.put('/prefs/:profileId', (req, res) => {
  const prefs = (req.body ?? {}) as Partial<Record<ServiceName, boolean>>;
  const clean: Partial<Record<ServiceName, boolean>> = {};
  for (const [service, enabled] of Object.entries(prefs)) {
    if (isServiceName(service) && typeof enabled === 'boolean') clean[service] = enabled;
  }
  setNotificationPrefs(req.userId!, req.params.profileId, clean);
  res.json({ prefs: clean, webhookUrls: buildWebhookUrls(req.userId!, req.params.profileId, clean) });
});

notificationRouter.post('/test/:profileId', async (req, res) => {
  const sent = await sendToUser(req.userId!, 'WalkerLab', 'Test notification - if you can see this, it works.');
  if (sent === 0) {
    res.status(400).json({ error: 'No registered devices found for this account.' });
    return;
  }
  res.json({ ok: true, sent });
});

// Publicly reachable and unauthenticated by nature (see header comment) -
// the per-service secret is cryptographically strong enough that brute-
// forcing it isn't realistic, but a generous per-IP rate limit is still
// cheap defense-in-depth against abuse, same reasoning as authRoutes.ts's
// own login limiter.
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// userId/profileId/service/secret are all taken from the URL itself
// (there's no session to derive them from), and the secret is the only
// thing standing in for auth here.
notificationWebhookRouter.post('/:userId/:profileId/:service/:secret', webhookLimiter, async (req, res) => {
  const { userId, profileId, service, secret } = req.params;
  if (!isServiceName(service)) {
    res.status(404).json({ error: 'Unknown service.' });
    return;
  }
  const expected = getNotificationWebhookSecret(userId, profileId, service);
  if (!expected || expected !== secret) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  // Toggled off since this URL was generated - a stale webhook config left
  // behind in Sonarr/Radarr/etc. after disabling never sends a push.
  if (getNotificationPrefs(userId, profileId)[service] !== true) {
    res.json({ ok: true, skipped: 'disabled' });
    return;
  }
  const content = parseNotificationPayload(service, req.body);
  if (!content) {
    res.json({ ok: true, skipped: 'unrecognized-event' });
    return;
  }
  const sent = await sendToUser(userId, content.title, content.body);
  res.json({ ok: true, sent });
});
