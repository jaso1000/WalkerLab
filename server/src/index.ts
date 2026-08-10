import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { requireAuth, seedAdminFromEnvIfAbsent } from './auth';
import { authRouter } from './authRoutes';
import { configRouter } from './configRoutes';
import { imageProxyRouter } from './imageProxyRoutes';
import { itunesRouter } from './itunesRoutes';
import { proxyRouter } from './proxyRoutes';
import { initStore } from './store';
import { tlsRouter } from './tlsRoutes';

const PORT = Number(process.env.PORT ?? 3000);
// Expo's web export output - copied to ./public by the Docker build (see
// Dockerfile). Falls back to a sibling `../public` for local dev against a
// manually-run `expo export -p web`.
const PUBLIC_DIR = process.env.WALKERLAB_PUBLIC_DIR ?? path.join(__dirname, '..', 'public');

async function main() {
  initStore();
  await seedAdminFromEnvIfAbsent();

  const app = express();
  // Needed for `req.secure`/`X-Forwarded-Proto` to reflect the real client
  // scheme when this process sits behind a reverse proxy/tunnel that
  // terminates TLS in front of it (see auth.ts's isSecureRequest), and so
  // express-rate-limit below keys off the real client IP (X-Forwarded-For)
  // instead of the tunnel/proxy's own address.
  app.set('trust proxy', 1);

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
  app.use('/api', requireAuth, configRouter);
  app.use('/api/proxy', requireAuth, proxyRouter);
  app.use('/api/image-proxy', requireAuth, imageProxyRouter);
  app.use('/api/itunes', requireAuth, itunesRouter);
  app.use('/api/tls', requireAuth, tlsRouter);

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
