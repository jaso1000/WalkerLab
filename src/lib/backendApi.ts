// Thin JSON-fetch helper for the web build's calls to its own Node backend
// (server/) - always same-origin (the backend serves the web build itself),
// always sends the session cookie. Only ever imported from web-only code
// paths inside otherwise-shared modules (storage.ts, profiles.ts, etc.) -
// native never calls this, since it has no backend to talk to.
export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed: ${res.status}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
