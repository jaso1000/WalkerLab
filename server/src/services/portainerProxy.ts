// Portainer-specific proxy logic: routes through `arrProxyRequest` (header
// API-key, plain fetch) normally, or through the pinned-certificate path
// (portainerTls.ts) when the profile has a `trustedCertFingerprint` set for
// an `https://` server - mirrors src/api/portainer.ts's own
// `portainerFetch`/`rawRequest` branching exactly, just server-side. Also
// handles the image-pull step of Recreate, which streams newline-delimited
// JSON progress events rather than returning one JSON body, so it can't go
// through the generic single-JSON-response proxy contract - the real
// apiKey/pin logic has to live here server-side either way, since the
// browser never holds the real apiKey to build this request itself.
import { arrProxyRequest } from './arrProxy';
import { pinnedFetch } from './portainerTls';
import { ProxyRequestBody, ServiceConfig } from '../types';

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function isPinned(config: ServiceConfig): boolean {
  return !!config.trustedCertFingerprint && config.baseUrl.startsWith('https://');
}

export async function portainerProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  if (!isPinned(config)) {
    return arrProxyRequest<T>(config, req);
  }

  const url = new URL(trimBase(config.baseUrl) + req.path);
  Object.entries(req.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await pinnedFetch(
    url.toString(),
    {
      method: req.method ?? 'GET',
      headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    },
    config.trustedCertFingerprint!
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${req.path} failed: ${res.status}`);
  }
  if (!res.body) return undefined as T;
  return JSON.parse(res.body) as T;
}

// Splits an image reference into repo + tag, mirroring
// src/api/portainer.ts's `parseImageRef` exactly (only a colon *after* the
// last slash can be a tag separator, so a registry host's own `:port` isn't
// mis-parsed as a tag).
function parseImageRef(image: string): { repo: string; tag: string } {
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return { repo: image.slice(0, lastColon), tag: image.slice(lastColon + 1) };
  }
  return { repo: image, tag: 'latest' };
}

export async function portainerPullImage(config: ServiceConfig, envId: number, image: string): Promise<void> {
  const { repo, tag } = parseImageRef(image);
  const url = new URL(`${trimBase(config.baseUrl)}/api/endpoints/${envId}/docker/images/create`);
  url.searchParams.set('fromImage', repo);
  url.searchParams.set('tag', tag);

  const options = { method: 'POST', headers: { 'X-Api-Key': config.apiKey } };
  const res = isPinned(config)
    ? await pinnedFetch(url.toString(), options, config.trustedCertFingerprint!).then((r) => ({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: r.body,
      }))
    : await fetch(url.toString(), options).then(async (r) => ({ ok: r.ok, status: r.status, text: await r.text() }));

  if (!res.ok) throw new Error(`Failed to pull ${image}: ${res.status}`);

  for (const line of res.text.split('\n')) {
    if (!line.trim()) continue;
    let event: { error?: string };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.error) throw new Error(event.error);
  }
}
