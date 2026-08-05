// Generic per-service proxy dispatcher - POST /api/proxy/:profileId/:service
// carries {path, method, params, body, form} (the same shape src/api/
// webProxy.ts sends), looks up that profile's real stored ServiceConfig
// (never trusts anything the browser sends about credentials), and
// dispatches to the matching server/src/services/*.ts module, which mirrors
// the client-side request logic almost line-for-line using Node's built-in
// fetch/tls/https.
import { Router } from 'express';
import { arrProxyRequest } from './services/arrProxy';
import { mergeServiceConfig } from './services/mergeServiceConfig';
import { nzbgetProxyRequest } from './services/nzbgetProxy';
import { portainerProxyRequest, portainerPullImage } from './services/portainerProxy';
import { qbittorrentProxyRequest } from './services/qbittorrentProxy';
import { omdbProxyRequest, sabnzbdProxyRequest, tautulliProxyRequest, tmdbProxyRequest } from './services/queryKeyProxy';
import { getServiceConfig } from './store';
import { isServiceName, ProxyRequestBody } from './types';

export const proxyRouter = Router();

// Recreate's pull-latest-image step streams newline-delimited JSON progress
// events rather than one JSON body, so it can't go through the generic
// single-response dispatcher below - a distinct 3-segment route (the
// generic route only ever matches 2 segments after this router's mount
// point, so there's no ordering conflict to worry about).
proxyRouter.post('/:profileId/portainer/pull-image', async (req, res) => {
  const { profileId } = req.params;
  const config = getServiceConfig(req.userId!, profileId, 'portainer');
  if (!config) {
    res.status(400).json({ error: "portainer isn't configured for this profile." });
    return;
  }
  const { envId, image } = (req.body ?? {}) as { envId?: number; image?: string };
  if (typeof envId !== 'number' || typeof image !== 'string') {
    res.status(400).json({ error: 'envId and image are required.' });
    return;
  }
  try {
    await portainerPullImage(config, envId, image);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Image pull failed.' });
  }
});

proxyRouter.post('/:profileId/:service', async (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  const body = (req.body ?? {}) as ProxyRequestBody;
  const config = mergeServiceConfig(getServiceConfig(req.userId!, profileId, service), body.configOverride);
  if (!config) {
    res.status(400).json({ error: `${service} isn't configured for this profile.` });
    return;
  }

  console.log(`[proxy] ${service} ${body.method ?? 'GET'} ${body.path} params=${JSON.stringify(body.params ?? {})}`);

  try {
    let result: unknown;
    switch (service) {
      case 'sonarr':
      case 'radarr':
      case 'overseerr':
        result = await arrProxyRequest(config, body);
        break;
      case 'portainer':
        // Decides pinned-vs-plain internally based on the profile's own
        // stored `trustedCertFingerprint` - see portainerProxy.ts.
        result = await portainerProxyRequest(config, body);
        break;
      case 'sabnzbd':
        result = await sabnzbdProxyRequest(config, body);
        break;
      case 'nzbget':
        result = await nzbgetProxyRequest(config, body);
        break;
      case 'tautulli':
        result = await tautulliProxyRequest(config, body);
        break;
      case 'tmdb':
        result = await tmdbProxyRequest(config, body);
        break;
      case 'omdb':
        result = await omdbProxyRequest(config, body);
        break;
      case 'qbittorrent':
        // Keyed by user+profile, not just profile - profile ids are only
        // unique within one user's own list, not globally across users.
        result = await qbittorrentProxyRequest(`${req.userId}:${profileId}`, config, body);
        break;
      default:
        res.status(501).json({ error: `Proxying for "${service}" isn't implemented yet.` });
        return;
    }
    console.log(
      `[proxy] ${service} ${body.path} -> ok, result=${
        Array.isArray(result) ? `array[${result.length}]` : JSON.stringify(result)?.slice(0, 300)
      }`
    );
    res.json(result ?? {});
  } catch (e) {
    console.error(`[proxy] ${service} ${body.path} -> FAILED:`, e);
    res.status(502).json({ error: e instanceof Error ? e.message : 'Upstream request failed.' });
  }
});
