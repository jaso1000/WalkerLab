// Node reimplementation of the "query-string API key" request pattern used
// by src/api/sabnzbd.ts, src/api/tautulli.ts, src/api/tmdb.ts, and
// src/api/omdb.ts. Each of these four has its own distinct dispatch/error
// shape (SABnzbd: single `/api` endpoint + `mode` param + `{error}` in a 200
// body; Tautulli: single `/api/v2` endpoint + `cmd` param +
// `{response:{result,message,data}}` wrapper; TMDB/OMDb: real REST-ish
// paths/fixed public base URLs + their own distinct error shapes) - close
// enough in spirit to share this one file, but not close enough to force
// through one generic function, so each gets its own small one mirroring its
// client-side counterpart closely.
import { ProxyRequestBody, ServiceConfig } from '../types';

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function sabnzbdProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  const url = new URL(trimBase(config.baseUrl) + req.path);
  url.searchParams.set('apikey', config.apiKey);
  Object.entries(req.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`SABnzbd request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json && typeof json === 'object' && 'error' in json && json.error) {
    throw new Error(String(json.error));
  }
  return json as T;
}

export async function tautulliProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  const url = new URL(trimBase(config.baseUrl) + req.path);
  url.searchParams.set('apikey', config.apiKey);
  Object.entries(req.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Tautulli request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { response?: { result?: string; message?: string; data?: unknown } };
  const response = json?.response;
  if (!response || response.result !== 'success') {
    throw new Error(response?.message || 'Tautulli request failed');
  }
  return response.data as T;
}

// TMDB's base URL is TMDB's own fixed public API, not a user-configured
// `config.baseUrl` (there's nothing self-hosted about it) - mirrors the
// hardcoded `BASE_URL` in src/api/tmdb.ts exactly.
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export async function tmdbProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  const url = new URL(TMDB_BASE_URL + req.path);
  url.searchParams.set('api_key', config.apiKey);
  Object.entries(req.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { status_message?: string } | null;
    throw new Error(body?.status_message ?? `TMDB request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// OMDb's base URL is likewise fixed and public - mirrors src/api/omdb.ts.
const OMDB_BASE_URL = 'https://www.omdbapi.com/';

export async function omdbProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  const url = new URL(OMDB_BASE_URL);
  url.searchParams.set('apikey', config.apiKey);
  Object.entries(req.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`OMDb request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
