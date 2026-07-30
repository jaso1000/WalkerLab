// Portainer API client. Portainer's own REST API authenticates the same way
// Sonarr/Radarr do - a static `X-API-Key` header, JSON in/out, tolerant of
// an empty response body - so this builds on `arrFetch`'s plumbing (the
// header name arrFetch sends, `X-Api-Key`, is treated case-insensitively by
// HTTP so it still matches Portainer's documented `X-API-Key`) rather than
// re-implementing it, *except* when the user has explicitly trusted a
// self-signed certificate for this server (`config.trustedCertFingerprint`
// - see the cert-trust flow on this service's Settings page) - RN's plain
// `fetch()` (what `arrFetch` uses) has no way to pin a certificate, so that
// case routes through the native `modules/tls-trust` module instead. See
// `portainerFetch` below and PLAN.md's Key decisions entry for the full
// "why" this exists at all.
//
// Two request shapes live here: (1) Portainer's own resources (`/api/stacks`,
// `/api/endpoints`), and (2) the Docker Engine API itself, which Portainer
// proxies 1:1 under `/api/endpoints/{envId}/docker/...` - container list/
// inspect/start/stop/etc. all go through that prefix.
import { Platform } from 'react-native';
import { pinnedFetch } from '../../modules/tls-trust';
import { arrFetch, ArrFetchOptions } from './arrFetch';
import { apiFetch } from '../lib/backendApi';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

export interface PortainerEndpoint {
  Id: number;
  Name: string;
}

// Portainer's own access-control metadata, injected into container list/
// inspect responses under a `Portainer.ResourceControl` key - not part of
// the raw Docker API. Only the fields needed for the simple ownership label
// shown on the container detail page are typed here.
export interface PortainerResourceControl {
  Public?: boolean;
  AdministratorsOnly?: boolean;
  TeamAccesses?: unknown[];
  UserAccesses?: unknown[];
}

// One entry from the Docker container-list endpoint (`ContainerSummary` in
// Docker's own API docs) - what powers both the Containers list and, by
// re-finding an entry by `Id`, the container detail page (its flat `Ports`
// array and unix-timestamp `Created` are easier to work with than the
// differently-shaped inspect response - see `getContainerById`).
export interface PortainerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string; // created | running | paused | restarting | removing | exited | dead
  Status: string; // e.g. "Up 15 days (healthy)" or "Exited (0) 2 hours ago"
  Labels: Record<string, string>;
  Ports: { IP?: string; PrivatePort: number; PublicPort?: number; Type: string }[];
  Created: number; // unix seconds
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
  Portainer?: { ResourceControl?: PortainerResourceControl };
}

// The full Docker container-inspect response - only used internally by
// `recreateContainer`, which needs the complete `Config`/`HostConfig` to
// clone a container. Untyped beyond what recreate actually reads.
interface PortainerContainerInspect {
  Name: string;
  Config: { Image: string } & Record<string, unknown>;
  HostConfig: Record<string, unknown>;
  NetworkSettings?: { Networks?: Record<string, unknown> };
}

export interface PortainerStack {
  Id: number;
  Name: string;
  Type: number; // 1 = swarm, 2 = compose
  EndpointId: number;
  Status: number; // 1 = active, 2 = inactive
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

// Lowest-level request helper - plain `fetch()` normally, or the native
// pinned-certificate path when the user has trusted a self-signed cert for
// this server. Returns a fetch-`Response`-like shape rather than a real
// `Response` object since the native module already reads the full body
// (no streaming either way - the only streaming response this API ever
// returns, the image-pull progress events in `pullImage` below, already
// gets fully buffered via `res.text()` today).
async function rawRequest(
  config: ServiceConfig,
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; ok: boolean; text: string }> {
  if (config.trustedCertFingerprint && config.baseUrl.startsWith('https://')) {
    const res = await pinnedFetch(url, options, config.trustedCertFingerprint);
    return { status: res.status, ok: res.status >= 200 && res.status < 300, text: res.body };
  }
  const res = await fetch(url, { method: options.method, headers: options.headers, body: options.body });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

// Same request/response shape as `arrFetch` (JSON in/out, empty-body
// tolerant, throws with a descriptive message on a non-2xx response) but
// routed through `rawRequest` above instead of a plain `fetch()` call, so
// every Portainer call in this file can go through the pinned-certificate
// path uniformly. Every other service is unaffected - this function isn't
// used anywhere outside this file.
async function portainerFetch<T>(config: ServiceConfig, path: string, options: ArrFetchOptions = {}): Promise<T> {
  // On web, the pinned-vs-plain decision (and the real apiKey/cert pin
  // needed to act on it) happens entirely server-side - see
  // server/src/services/portainerProxy.ts - so this always routes through
  // the generic proxy on web regardless of `trustedCertFingerprint`,
  // skipping `rawRequest`/`pinnedFetch` (the Android-native-module path)
  // entirely. `arrFetch`'s own web branch would reach the same backend
  // route anyway, but going straight there avoids the pointless
  // `!config.trustedCertFingerprint` check below on a redacted (blank) web
  // config.
  if (Platform.OS === 'web') {
    return webProxyFetch<T>('portainer', config, { path, method: options.method, params: options.params, body: options.body });
  }

  if (!config.trustedCertFingerprint || !config.baseUrl.startsWith('https://')) {
    return arrFetch<T>(config, path, options, 'portainer');
  }

  const url = new URL(trimBase(config.baseUrl) + path);
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const res = await rawRequest(config, url.toString(), {
    method: options.method ?? 'GET',
    headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  if (!res.text) return undefined as T;
  return JSON.parse(res.text);
}

// Portainer can manage multiple Docker "environments" (endpoints); this app
// doesn't expose a picker for that (no Settings field for it - see
// PLAN.md), it just auto-selects the first environment `/api/endpoints`
// returns and caches the id for the lifetime of the app, keyed by
// URL+API-key so switching profiles/servers re-resolves correctly.
const endpointIdCache = new Map<string, number>();
const cacheKey = (config: ServiceConfig) => `${config.baseUrl}|${config.apiKey}`;

async function resolvePrimaryEndpointId(config: ServiceConfig): Promise<number> {
  const key = cacheKey(config);
  const cached = endpointIdCache.get(key);
  if (cached !== undefined) return cached;
  const endpoints = await portainerFetch<PortainerEndpoint[]>(config, '/api/endpoints');
  if (!endpoints.length) throw new Error('No Portainer environments found.');
  endpointIdCache.set(key, endpoints[0].Id);
  return endpoints[0].Id;
}

// Splits an image reference into repo + tag for the pull-image call, without
// mis-splitting a registry host's own `:port` (e.g.
// "registry.example.com:5000/foo/bar" has no tag, so it should default to
// "latest" rather than parsing "5000/foo/bar" as the tag). The trick: only a
// colon *after* the last slash can be a tag separator.
function parseImageRef(image: string): { repo: string; tag: string } {
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return { repo: image.slice(0, lastColon), tag: image.slice(lastColon + 1) };
  }
  return { repo: image, tag: 'latest' };
}

// The Docker image-pull endpoint streams newline-delimited JSON progress
// events rather than returning one JSON object, so it goes through
// `rawRequest` directly (not `portainerFetch`, which assumes a single JSON
// body), reading the full response just to detect a `{"error": "..."}`
// line before treating the pull as done. On web this can't go through the
// generic single-JSON-response proxy either (same NDJSON shape problem),
// nor could the browser build this request itself even with a raw
// pass-through (it never holds the real apiKey/cert pin) - so the entire
// pull-and-scan-for-errors operation happens server-side in one call to a
// dedicated route (see server/src/services/portainerProxy.ts's
// `portainerPullImage`, mirroring this function almost line-for-line).
async function pullImage(config: ServiceConfig, envId: number, image: string): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/proxy/${config.profileId}/portainer/pull-image`, { method: 'POST', body: { envId, image } });
    return;
  }

  const { repo, tag } = parseImageRef(image);
  const url = new URL(`${trimBase(config.baseUrl)}/api/endpoints/${envId}/docker/images/create`);
  url.searchParams.set('fromImage', repo);
  url.searchParams.set('tag', tag);

  const res = await rawRequest(config, url.toString(), { method: 'POST', headers: { 'X-API-Key': config.apiKey } });
  if (!res.ok) throw new Error(`Failed to pull ${image}: ${res.status}`);

  for (const line of res.text.split('\n')) {
    if (!line.trim()) continue;
    let event: { error?: string };
    try {
      event = JSON.parse(line);
    } catch {
      continue; // not a JSON progress line, ignore
    }
    if (event.error) throw new Error(event.error);
  }
}

async function containerAction(config: ServiceConfig, id: string, action: string, params?: Record<string, string>) {
  const envId = await resolvePrimaryEndpointId(config);
  await portainerFetch(config, `/api/endpoints/${envId}/docker/containers/${id}/${action}`, { method: 'POST', params });
}

export const portainerApi = {
  // Settings' "Test Connection" check - listing environments requires valid
  // auth, and doubles as the same lookup `resolvePrimaryEndpointId` needs
  // anyway.
  testConnection: (config: ServiceConfig) => resolvePrimaryEndpointId(config),

  getPrimaryEndpointId: resolvePrimaryEndpointId,

  listContainers: async (config: ServiceConfig): Promise<PortainerContainer[]> => {
    const envId = await resolvePrimaryEndpointId(config);
    return portainerFetch<PortainerContainer[]>(config, `/api/endpoints/${envId}/docker/containers/json`, {
      params: { all: 'true' },
    });
  },

  startContainer: (config: ServiceConfig, id: string) => containerAction(config, id, 'start'),
  stopContainer: (config: ServiceConfig, id: string) => containerAction(config, id, 'stop'),
  killContainer: (config: ServiceConfig, id: string) => containerAction(config, id, 'kill'),
  restartContainer: (config: ServiceConfig, id: string) => containerAction(config, id, 'restart'),
  pauseContainer: (config: ServiceConfig, id: string) => containerAction(config, id, 'pause'),
  resumeContainer: (config: ServiceConfig, id: string) => containerAction(config, id, 'unpause'),

  removeContainer: async (config: ServiceConfig, id: string) => {
    const envId = await resolvePrimaryEndpointId(config);
    await portainerFetch(config, `/api/endpoints/${envId}/docker/containers/${id}`, {
      method: 'DELETE',
      params: { force: 'true' },
    });
  },

  // Portainer's own UI has no single API call for "Recreate" either - it
  // orchestrates the same sequence client-side: inspect the current
  // container's full config, optionally pull the latest image, stop +
  // remove the old container, then create + start a new one from the
  // inspected config. This is a best-effort clone (see PLAN.md) - fine for
  // the standard single-network bridge containers this app's whole stack
  // uses, but not guaranteed to preserve every possible Docker config edge
  // case.
  recreateContainer: async (config: ServiceConfig, id: string, pullLatestImage: boolean): Promise<void> => {
    const envId = await resolvePrimaryEndpointId(config);
    const inspect = await portainerFetch<PortainerContainerInspect>(
      config,
      `/api/endpoints/${envId}/docker/containers/${id}/json`
    );
    const name = inspect.Name.replace(/^\//, '');

    if (pullLatestImage) await pullImage(config, envId, inspect.Config.Image);

    await containerAction(config, id, 'stop');
    await portainerFetch(config, `/api/endpoints/${envId}/docker/containers/${id}`, {
      method: 'DELETE',
      params: { force: 'true' },
    });

    const created = await portainerFetch<{ Id: string }>(config, `/api/endpoints/${envId}/docker/containers/create`, {
      method: 'POST',
      params: { name },
      body: {
        ...inspect.Config,
        HostConfig: inspect.HostConfig,
        NetworkingConfig: { EndpointsConfig: inspect.NetworkSettings?.Networks ?? {} },
      },
    });

    await containerAction(config, created.Id, 'start');
  },

  listStacks: (config: ServiceConfig) => portainerFetch<PortainerStack[]>(config, '/api/stacks'),

  startStack: (config: ServiceConfig, stack: PortainerStack) =>
    portainerFetch(config, `/api/stacks/${stack.Id}/start`, { method: 'POST', params: { endpointId: String(stack.EndpointId) } }),

  stopStack: (config: ServiceConfig, stack: PortainerStack) =>
    portainerFetch(config, `/api/stacks/${stack.Id}/stop`, { method: 'POST', params: { endpointId: String(stack.EndpointId) } }),
};

// Display helpers - pure, no network - kept here alongside the types they
// operate on rather than in the generic `format.ts` grab-bag, since they're
// specific to this one API's response shapes.

export function containerName(c: PortainerContainer): string {
  return c.Names[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
}

// Docker sets this label to the compose project name for every container
// started via `docker-compose`/a Portainer stack - matches how Portainer's
// own container list derives its "Stack" column.
export function containerStackName(c: PortainerContainer): string | undefined {
  return c.Labels?.['com.docker.compose.project'];
}

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting';

// Docker's `Status` field embeds health as free text, e.g. "Up 15 days
// (healthy)" - extracted separately so it can render as its own badge next
// to the plain running/exited state, matching Portainer's own list view.
export function parseContainerHealth(status: string): ContainerHealth | null {
  const match = status.match(/\((healthy|unhealthy|starting)\)/);
  return (match?.[1] as ContainerHealth) ?? null;
}

// The single status word shown on a container's card/badge - health takes
// precedence over the raw run state when a healthcheck is configured,
// matching Portainer's own container list (a healthy container shows
// "healthy", not "running").
export function containerStatusLabel(c: PortainerContainer): string {
  return parseContainerHealth(c.Status) ?? c.State;
}

// Docker's `Status` field already carries a human-readable uptime/exit
// phrase (e.g. "Up 15 days (healthy)", "Up 2 hours", "Exited (0) 3 hours
// ago") - reformatted for display rather than recomputing elapsed time
// from `Created` ourselves, since Docker's own string is authoritative
// (it already accounts for restarts/pauses) and matches the "Running for
// 15 days" phrasing on the reference Portainer screenshot this detail
// page is modeled on. Returns null for states with no natural phrase
// (e.g. "Created") rather than showing something misleading.
export function containerUptimeLabel(status: string): string | null {
  const up = status.match(/^Up (.+)$/);
  if (up) return `Running for ${up[1].replace(/\s*\([^)]*\)\s*$/, '').trim()}`;
  const exited = status.match(/^Exited \(\d+\) (.+)$/);
  if (exited) return `Exited ${exited[1]}`;
  return null;
}

export function containerIpAddress(c: PortainerContainer): string | undefined {
  const networks = c.NetworkSettings?.Networks ?? {};
  return Object.values(networks).find((n) => n.IPAddress)?.IPAddress;
}

// Only entries with a `PublicPort` are actually published to the host -
// matches the "Published Ports" column in the reference screenshots
// (host:container, e.g. "3443:443").
export function publishedPorts(c: PortainerContainer): string[] {
  return c.Ports.filter((p) => p.PublicPort).map((p) => `${p.PublicPort}:${p.PrivatePort}`);
}

// Simplified ownership label for the container detail page - this app has
// no multi-team/user concept of its own (personal single-user app), so
// specific team/user names aren't resolved, just the broad access shape.
export function ownershipLabel(rc?: PortainerResourceControl): string {
  if (!rc) return 'Unassigned';
  if (rc.Public) return 'Public';
  if (rc.AdministratorsOnly) return 'Administrators';
  if ((rc.TeamAccesses?.length ?? 0) > 0 || (rc.UserAccesses?.length ?? 0) > 0) return 'Restricted';
  return 'Unassigned';
}

export function stackTypeLabel(type: number): string {
  return type === 1 ? 'Swarm' : 'Compose';
}

// Best-effort deep link into Portainer's own web UI (AngularJS hash routes)
// for the "edit directly" link-out both detail pages offer - worst case if
// Portainer's route shape has changed is a 404 in-browser, not a functional
// risk, so this isn't guarded any more carefully than that.
export function containerWebUrl(config: ServiceConfig, envId: number, containerId: string): string {
  return `${trimBase(config.baseUrl)}/#!/${envId}/docker/containers/${containerId}`;
}

export function stackWebUrl(config: ServiceConfig, envId: number, stackId: number): string {
  return `${trimBase(config.baseUrl)}/#!/${envId}/docker/stacks/${stackId}?type=2`;
}
