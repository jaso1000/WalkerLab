// Redacted-secret config CRUD + profile management - everything behind
// `requireAuth` (mounted in index.ts). Secrets (apiKey/password) are never
// returned to the browser once set; a PUT only overwrites a secret field
// when the client explicitly sends a new value, otherwise the existing
// stored value is preserved (so re-saving just the baseUrl doesn't blank out
// a key the browser was never shown).
import { Router } from 'express';
import {
  deleteProfileData,
  getActiveProfileId,
  getSectionNameOverrides,
  getServiceConfig,
  getServiceEnabledOverrides,
  getStartupScreen,
  getProfiles,
  setActiveProfileId,
  setProfiles,
  setSectionNameOverrides,
  setServiceConfig,
  setServiceEnabledOverrides,
  setStartupScreen,
  clearServiceConfig,
} from './store';
import { isServiceName, Profile, SectionId, ServiceConfig, ServiceName, StartupSectionId } from './types';

export const configRouter = Router();

// --- Profiles ------------------------------------------------------------
// Deliberately mirrors src/lib/profiles.ts's whole-list get/set contract
// exactly (rather than a granular create/rename/delete REST shape) so
// ProfilesContext.tsx - which already does client-side id generation and
// optimistic list updates, with a real prior bug around stale-closure
// `setState` fixed there - needs zero changes to work against this backend.

configRouter.get('/profiles', (_req, res) => {
  res.json(getProfiles());
});

configRouter.put('/profiles', (req, res) => {
  const next = req.body as Profile[];
  if (!Array.isArray(next) || next.length === 0) {
    res.status(400).json({ error: 'At least one profile is required.' });
    return;
  }
  // Any profile present before but missing now is being deleted - clean up
  // its service configs/section-names/etc. so removed profiles don't leave
  // stale encrypted credentials behind indefinitely (native's AsyncStorage
  // equivalent doesn't do this cleanup today, but there's no reason a
  // long-lived server-side store shouldn't).
  const previousIds = getProfiles().map((p) => p.id);
  const nextIds = new Set(next.map((p) => p.id));
  previousIds.filter((id) => !nextIds.has(id)).forEach(deleteProfileData);
  setProfiles(next);
  res.json({ ok: true });
});

configRouter.get('/profiles/active', (_req, res) => {
  res.json({ id: getActiveProfileId() });
});

configRouter.put('/profiles/active', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
  if (!id) {
    res.status(400).json({ error: 'id is required.' });
    return;
  }
  setActiveProfileId(id);
  res.json({ ok: true });
});

// --- Service configs -----------------------------------------------------

configRouter.get('/config/:profileId/:service', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  const config = getServiceConfig(profileId, service);
  if (!config) {
    res.json({ isConfigured: false });
    return;
  }
  res.json({
    isConfigured: true,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    hasPassword: !!config.password,
    username: config.username,
    trustedCertFingerprint: config.trustedCertFingerprint,
  });
});

// Full, unredacted config (real apiKey/password included) - used
// exclusively by src/lib/profileBackup.ts's web branch. The normal GET
// above redacts secrets everywhere else in the app; this exists only
// because Backup needs the real values to encrypt client-side (the same
// way native already does), otherwise a web-created backup would silently
// contain blank credentials. Still behind the same session-cookie auth as
// every other route here - on a single-admin app, the logged-in admin
// could always change any secret to a known value via PUT and diff anyway,
// so this doesn't cross a real privilege boundary, just skips a redundant
// round trip for a case that legitimately needs the real value.
configRouter.get('/config/:profileId/:service/unredacted', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  res.json(getServiceConfig(profileId, service) ?? null);
});

configRouter.put('/config/:profileId/:service', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  const body = req.body ?? {};
  if (typeof body.baseUrl !== 'string') {
    res.status(400).json({ error: 'baseUrl is required.' });
    return;
  }
  const existing = getServiceConfig(profileId, service);
  const next: ServiceConfig = {
    baseUrl: body.baseUrl,
    // Only overwrite a secret when the client explicitly sent a non-empty
    // new value - omitting/blanking it preserves whatever's already stored.
    apiKey: typeof body.apiKey === 'string' && body.apiKey.length > 0 ? body.apiKey : existing?.apiKey ?? '',
    username: typeof body.username === 'string' ? body.username : existing?.username,
    password: typeof body.password === 'string' && body.password.length > 0 ? body.password : existing?.password,
    trustedCertFingerprint:
      typeof body.trustedCertFingerprint === 'string' ? body.trustedCertFingerprint : existing?.trustedCertFingerprint,
  };
  setServiceConfig(profileId, service, next);
  res.json({ ok: true });
});

configRouter.delete('/config/:profileId/:service', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  clearServiceConfig(profileId, service);
  res.json({ ok: true });
});

// --- Section names / service enabled / startup screen -----------------------

configRouter.get('/section-names/:profileId', (req, res) => {
  res.json(getSectionNameOverrides(req.params.profileId));
});

configRouter.put('/section-names/:profileId', (req, res) => {
  setSectionNameOverrides(req.params.profileId, (req.body ?? {}) as Partial<Record<SectionId, string>>);
  res.json({ ok: true });
});

configRouter.get('/service-enabled/:profileId', (req, res) => {
  res.json(getServiceEnabledOverrides(req.params.profileId));
});

configRouter.put('/service-enabled/:profileId', (req, res) => {
  setServiceEnabledOverrides(req.params.profileId, (req.body ?? {}) as Partial<Record<ServiceName, boolean>>);
  res.json({ ok: true });
});

configRouter.get('/startup-screen/:profileId', (req, res) => {
  res.json({ id: getStartupScreen(req.params.profileId) ?? null });
});

configRouter.put('/startup-screen/:profileId', (req, res) => {
  const id = req.body?.id as StartupSectionId | undefined;
  if (!id) {
    res.status(400).json({ error: 'id is required.' });
    return;
  }
  setStartupScreen(req.params.profileId, id);
  res.json({ ok: true });
});
