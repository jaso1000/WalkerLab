// Merges a possibly-partial override (what's currently typed in a client
// screen, not necessarily saved yet) over a profile's real stored config.
// Secrets (apiKey/password) only get overwritten by a non-empty override
// value - a blank secret field means "keep whatever's already stored,"
// never "clear it." Non-secret fields (baseUrl/username/
// trustedCertFingerprint) always take the override value when the caller
// sent one, even if blank. Mirrors the exact merge rule
// `PUT /api/config/:profileId/:service` (configRoutes.ts) uses when saving,
// so a request built this way behaves identically to "save, then request."
import { ServiceConfig } from '../types';

export function mergeServiceConfig(
  existing: ServiceConfig | undefined,
  override: Partial<ServiceConfig> | undefined
): ServiceConfig | undefined {
  if (!override) return existing;
  return {
    baseUrl: typeof override.baseUrl === 'string' ? override.baseUrl : existing?.baseUrl ?? '',
    apiKey: typeof override.apiKey === 'string' && override.apiKey.length > 0 ? override.apiKey : existing?.apiKey ?? '',
    username: typeof override.username === 'string' ? override.username : existing?.username,
    password: typeof override.password === 'string' && override.password.length > 0 ? override.password : existing?.password,
    trustedCertFingerprint:
      typeof override.trustedCertFingerprint === 'string' ? override.trustedCertFingerprint : existing?.trustedCertFingerprint,
  };
}
