// Node reimplementation of src/api/nzbget.ts's request logic - NZBGet
// speaks JSON-RPC 1.0 over one fixed path (`/jsonrpc`): every call POSTs
// `{method, params}` and gets back `{result}` on success or `{error}` on
// failure. `req.body` here is the JSON-RPC envelope itself (the generic
// `ProxyRequestBody.body` field) - `req.path`/`req.method` (the HTTP verb)
// aren't meaningfully used since every NZBGet call is the exact same POST
// to the exact same path, unlike the REST-ish services this same proxy
// layer also serves.
import { ProxyRequestBody, ServiceConfig } from '../types';

export async function nzbgetProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  const url = config.baseUrl.replace(/\/+$/, '') + '/jsonrpc';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else {
    headers.Authorization = `Basic ${Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`).toString('base64')}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(req.body) });
  if (!res.ok) {
    throw new Error(`NZBGet request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? 'NZBGet request failed');
  }
  return json.result as T;
}
