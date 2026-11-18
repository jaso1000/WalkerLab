// GET-based image proxy - used by src/api/tautulli.ts's `tautulliImageUrl()`
// on web. Unlike the JSON proxy (POST /api/proxy/...), this needs to be a
// plain GET so an `<img src="...">`/`expo-image` component can point at it
// directly; a real `<img>` tag can't reach the user's LAN-only Tautulli
// instance any more than a `fetch()` call could, so this fetches the image
// bytes server-side (where the real credentials/network access live) and
// streams them back. Session-cookie auth still applies (browsers send
// same-origin cookies automatically on `<img>` requests, no extra wiring
// needed) - mounted behind `requireImageAuth` in index.ts, which also takes
// the native app's server-mode image token (an `<Image>` there can't send
// the Bearer header the rest of its requests use).
//
// TMDB doesn't need this: `tmdbImageUrl()` points straight at TMDB's own
// public CDN (image.tmdb.org), which every browser can already reach
// directly, tunnel or not - no credentials involved either.
//
// Lidarr also uses this (see `lidarrImageUrl()` in `src/api/lidarr.ts`),
// same reasoning as Tautulli - the real API key never reaches the browser
// on web, so a direct `<Image src>` can't authenticate itself against
// Lidarr's `/api/v1/mediacover/...` route the way a native request (which
// does have the real key) can.
import { Response, Router } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { validateIdParam } from './auth';
import { getServiceConfig } from './store';

export const imageProxyRouter = Router();
imageProxyRouter.param('profileId', validateIdParam);

// Streams the upstream image straight through instead of buffering the whole
// file in memory first - less memory per request and the first bytes reach
// the client sooner. `private` cache: this route sits behind session auth, so
// no shared/CDN cache should keep it; images never change for a given item.
async function sendImage(upstream: globalThis.Response, res: Response) {
  res.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=604800, immutable');
  // No Content-Length passthrough: fetch() transparently un-gzips, so the
  // upstream's length can be wrong for the bytes actually sent.
  if (!upstream.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body as unknown as WebReadableStream), res);
}

// Once streaming has started the status/headers are already sent, so a
// failure can only cut the response off, not turn it into a JSON error.
function failImage(res: Response, e: unknown) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(502).json({ error: e instanceof Error ? e.message : 'Upstream image request failed.' });
}

imageProxyRouter.get('/:profileId/:service', async (req, res) => {
  const { profileId, service } = req.params;

  if (service === 'lidarr') {
    const config = getServiceConfig(req.userId!, profileId, 'lidarr');
    if (!config) {
      res.status(400).json({ error: 'Lidarr is not configured for this profile.' });
      return;
    }
    const { entityType, entityId, filename } = req.query;
    if (typeof entityType !== 'string' || typeof entityId !== 'string' || typeof filename !== 'string') {
      res.status(400).json({ error: 'Missing entityType/entityId/filename.' });
      return;
    }
    const url = new URL(`${config.baseUrl.replace(/\/+$/, '')}/api/v1/mediacover/${entityType}/${entityId}/${filename}`);
    url.searchParams.set('apikey', config.apiKey);
    try {
      const upstream = await fetch(url.toString());
      if (!upstream.ok) {
        res.status(502).json({ error: `Lidarr image request failed: ${upstream.status}` });
        return;
      }
      await sendImage(upstream, res);
    } catch (e) {
      failImage(res, e);
    }
    return;
  }

  if (service !== 'tautulli') {
    res.status(501).json({ error: `Image proxying for "${service}" isn't implemented.` });
    return;
  }
  const config = getServiceConfig(req.userId!, profileId, 'tautulli');
  if (!config) {
    res.status(400).json({ error: 'Tautulli is not configured for this profile.' });
    return;
  }

  const url = new URL(config.baseUrl.replace(/\/+$/, '') + '/api/v2');
  url.searchParams.set('apikey', config.apiKey);
  url.searchParams.set('cmd', 'pms_image_proxy');
  for (const [key, value] of Object.entries(req.query)) {
    // `token` is the native app's image token (auth.ts's requireImageAuth already drops it) - never
    // pass a WalkerLab credential on to Tautulli.
    if (typeof value === 'string' && key !== 'token') url.searchParams.set(key, value);
  }

  try {
    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      res.status(502).json({ error: `Tautulli image request failed: ${upstream.status}` });
      return;
    }
    await sendImage(upstream, res);
  } catch (e) {
    failImage(res, e);
  }
});
