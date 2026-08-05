// GET-based image proxy - used by src/api/tautulli.ts's `tautulliImageUrl()`
// on web. Unlike the JSON proxy (POST /api/proxy/...), this needs to be a
// plain GET so an `<img src="...">`/`expo-image` component can point at it
// directly; a real `<img>` tag can't reach the user's LAN-only Tautulli
// instance any more than a `fetch()` call could, so this fetches the image
// bytes server-side (where the real credentials/network access live) and
// streams them back. Session-cookie auth still applies (browsers send
// same-origin cookies automatically on `<img>` requests, no extra wiring
// needed) - mounted behind `requireAuth` in index.ts same as everything else.
//
// TMDB doesn't need this: `tmdbImageUrl()` points straight at TMDB's own
// public CDN (image.tmdb.org), which every browser can already reach
// directly, tunnel or not - no credentials involved either.
import { Router } from 'express';
import { getServiceConfig } from './store';

export const imageProxyRouter = Router();

imageProxyRouter.get('/:profileId/:service', async (req, res) => {
  const { profileId, service } = req.params;
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
    if (typeof value === 'string') url.searchParams.set(key, value);
  }

  try {
    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      res.status(502).json({ error: `Tautulli image request failed: ${upstream.status}` });
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    // Tautulli's proxied images never change for a given item - without this
    // the browser re-fetches (and this server re-proxies) the same
    // poster/thumbnail on every render. `private` since this route sits
    // behind session auth, not a shared/CDN cache.
    res.set('Cache-Control', 'private, max-age=604800, immutable');
    res.send(buffer);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Upstream image request failed.' });
  }
});
