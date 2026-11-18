import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { requireAuth, requireImageAuth, seedAdminFromEnvIfAbsent } from './auth';
import { authRouter } from './authRoutes';
import { configRouter } from './configRoutes';
import { imageProxyRouter } from './imageProxyRoutes';
import { itunesRouter } from './itunesRoutes';
import { notificationRouter, notificationWebhookRouter } from './notificationRoutes';
import { proxyRouter } from './proxyRoutes';
import { initStore } from './store';
import { tlsRouter } from './tlsRoutes';

const PORT = Number(process.env.PORT ?? 3000);
// Expo's web export output - copied to ./public by the Docker build (see
// Dockerfile). Falls back to a sibling `../public` for local dev against a
// manually-run `expo export -p web`.
const PUBLIC_DIR = process.env.WALKERLAB_PUBLIC_DIR ?? path.join(__dirname, '..', 'public');

// How many/which proxies in front of this process to believe about the real
// client IP (X-Forwarded-For) and scheme (X-Forwarded-Proto). Default `1`
// fits the documented setup (one tunnel/reverse proxy in front). With NO
// proxy in front - e.g. the port exposed straight to a LAN - `1` lets any
// client invent its own X-Forwarded-For and dodge the per-IP login rate
// limit, so such installs should set WALKERLAB_TRUST_PROXY=false (or
// `loopback` when the only proxy runs on the same machine; the Windows
// installer does this). Accepts false/true, a hop count, or anything
// Express's `trust proxy` takes (comma-separated IPs/subnets, `loopback`,
// `uniquelocal`, ...).
function trustProxySetting(): boolean | number | string {
  const raw = process.env.WALKERLAB_TRUST_PROXY?.trim();
  if (!raw) return 1;
  const lower = raw.toLowerCase();
  if (lower === 'false' || lower === 'no' || lower === 'off') return false;
  if (lower === 'true' || lower === 'yes' || lower === 'on') return true;
  if (/^\d+$/.test(raw)) return Number(raw) === 0 ? false : Number(raw);
  return raw;
}

async function main() {
  initStore();
  await seedAdminFromEnvIfAbsent();

  const app = express();
  // Needed for `req.secure`/`X-Forwarded-Proto` to reflect the real client
  // scheme when this process sits behind a reverse proxy/tunnel that
  // terminates TLS in front of it (see auth.ts's isSecureRequest), and so
  // express-rate-limit below keys off the real client IP (X-Forwarded-For)
  // instead of the tunnel/proxy's own address.
  app.set('trust proxy', trustProxySetting());

  // CSP left off deliberately: the Expo web export and its poster/backdrop
  // images (TMDB, OMDb, Tautulli's pms_image_proxy) span enough external
  // origins that a correct policy needs a real audit first, and a wrong one
  // silently breaks images/fonts rather than failing loudly. COEP also left
  // off - TMDB's image CDN doesn't send a Cross-Origin-Resource-Policy
  // header, and `require-corp` (helmet's default) would block those images
  // from ever loading. Everything else helmet sets (HSTS, X-Frame-Options,
  // X-Content-Type-Options, hides X-Powered-By, etc.) applies as normal.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  app.use(cookieParser());
  app.use(express.json());

  app.use('/api/auth', authRouter);
  // Must be registered before the broad `app.use('/api', requireAuth, ...)`
  // mount below - Express applies that middleware to every /api/* path by
  // prefix match regardless of whether configRouter itself has a matching
  // route, so a later, more specific /api/webhooks mount would never be
  // reached and this deliberately-unauthenticated route (see
  // notificationRoutes.ts's header comment - Sonarr/Radarr/Lidarr/Overseerr
  // can't do cookie or bearer auth, the path-embedded secret is the auth)
  // would get rejected by requireAuth before its own handler ever ran.
  app.use('/api/webhooks', notificationWebhookRouter);
  // Also ahead of the broad `/api` mount, for the same reason: the image
  // proxy additionally accepts the native app's image token (see
  // requireImageAuth), which requireAuth would reject first.
  app.use('/api/image-proxy', requireImageAuth, imageProxyRouter);
  app.use('/api', requireAuth, configRouter);
  app.use('/api/proxy', requireAuth, proxyRouter);
  app.use('/api/itunes', requireAuth, itunesRouter);
  app.use('/api/tls', requireAuth, tlsRouter);
  app.use('/api/notifications', requireAuth, notificationRouter);

  app.use(express.static(PUBLIC_DIR));

  // SPA client-side routing fallback: any non-/api path that isn't a real
  // static file falls through to index.html so a hard refresh on a deep
  // route (e.g. /settings/sonarr) doesn't 404.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`WalkerLab server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
