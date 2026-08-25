// Redacted-secret config CRUD + profile management - everything behind
// `requireAuth` (mounted in index.ts), which guarantees `req.userId` is set
// by the time any handler here runs. Every route is scoped to the calling
// user's own data via that id - a user can only ever see/touch their own
// profiles and service configs, never another user's, even by guessing
// another user's profile id (profile ids aren't looked up on their own
// anywhere here, always nested under `req.userId` first). Secrets (apiKey/
// password) are never returned to the browser once set; a PUT only
// overwrites a secret field when the client explicitly sends a new value,
// otherwise the existing stored value is preserved (so re-saving just the
// baseUrl doesn't blank out a key the browser was never shown).
import { Router } from 'express';
import { mergeServiceConfig } from './services/mergeServiceConfig';
import {
  deleteProfileData,
  getActiveProfileId,
  getSectionNameOverrides,
  getServiceConfig,
  getServiceEnabledOverrides,
  getStartupScreen,
  getTabOrder,
  getProfiles,
  setActiveProfileId,
  setProfiles,
  setSectionNameOverrides,
  setServiceConfig,
  setServiceEnabledOverrides,
  setStartupScreen,
  setTabOrder,
  clearServiceConfig,
  getVisibleWheels,
  saveWheel,
  deleteWheel,
} from './store';
import { isServiceName, Profile, SectionId, ServiceConfig, ServiceName, StartupSectionId, Wheel } from './types';

export const configRouter = Router();

// --- Profiles ------------------------------------------------------------
// Deliberately mirrors src/lib/profiles.ts's whole-list get/set contract
// exactly (rather than a granular create/rename/delete REST shape) so
// ProfilesContext.tsx - which already does client-side id generation and
// optimistic list updates, with a real prior bug around stale-closure
// `setState` fixed there - needs zero changes to work against this backend.
// Notably, none of this needed any client-side changes to support multiple
// users either: the client never sends a userId anywhere, it's always
// implicit in the session cookie, so "your own profiles" already meant
// exactly that once the server started scoping by req.userId here.

configRouter.get('/profiles', (req, res) => {
  res.json(getProfiles(req.userId!));
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
  const previousIds = getProfiles(req.userId!).map((p) => p.id);
  const nextIds = new Set(next.map((p) => p.id));
  previousIds.filter((id) => !nextIds.has(id)).forEach((id) => deleteProfileData(req.userId!, id));
  setProfiles(req.userId!, next);
  res.json({ ok: true });
});

configRouter.get('/profiles/active', (req, res) => {
  res.json({ id: getActiveProfileId(req.userId!) });
});

configRouter.put('/profiles/active', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
  if (!id) {
    res.status(400).json({ error: 'id is required.' });
    return;
  }
  setActiveProfileId(req.userId!, id);
  res.json({ ok: true });
});

// --- Service configs -----------------------------------------------------

configRouter.get('/config/:profileId/:service', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  const config = getServiceConfig(req.userId!, profileId, service);
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
// every other route here - the logged-in user could always change any of
// their own secrets to a known value via PUT and diff anyway, so this
// doesn't cross a real privilege boundary, just skips a redundant round
// trip for a case that legitimately needs the real value. Scoped to
// req.userId same as everything else, so it only ever exposes the calling
// user's own secrets, never another user's.
configRouter.get('/config/:profileId/:service/unredacted', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  res.json(getServiceConfig(req.userId!, profileId, service) ?? null);
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
  // `mergeServiceConfig` always returns a real ServiceConfig here (never
  // undefined) since `body` is a real object, not undefined.
  const next = mergeServiceConfig(getServiceConfig(req.userId!, profileId, service), body) as ServiceConfig;
  setServiceConfig(req.userId!, profileId, service, next);
  res.json({ ok: true });
});

configRouter.delete('/config/:profileId/:service', (req, res) => {
  const { profileId, service } = req.params;
  if (!isServiceName(service)) {
    res.status(400).json({ error: `Unknown service "${service}".` });
    return;
  }
  clearServiceConfig(req.userId!, profileId, service);
  res.json({ ok: true });
});

// --- Section names / service enabled / startup screen -----------------------

configRouter.get('/section-names/:profileId', (req, res) => {
  res.json(getSectionNameOverrides(req.userId!, req.params.profileId));
});

configRouter.put('/section-names/:profileId', (req, res) => {
  setSectionNameOverrides(req.userId!, req.params.profileId, (req.body ?? {}) as Partial<Record<SectionId, string>>);
  res.json({ ok: true });
});

configRouter.get('/service-enabled/:profileId', (req, res) => {
  res.json(getServiceEnabledOverrides(req.userId!, req.params.profileId));
});

configRouter.put('/service-enabled/:profileId', (req, res) => {
  setServiceEnabledOverrides(req.userId!, req.params.profileId, (req.body ?? {}) as Partial<Record<ServiceName, boolean>>);
  res.json({ ok: true });
});

configRouter.get('/startup-screen/:profileId', (req, res) => {
  res.json({ id: getStartupScreen(req.userId!, req.params.profileId) ?? null });
});

configRouter.put('/startup-screen/:profileId', (req, res) => {
  const id = req.body?.id as StartupSectionId | undefined;
  if (!id) {
    res.status(400).json({ error: 'id is required.' });
    return;
  }
  setStartupScreen(req.userId!, req.params.profileId, id);
  res.json({ ok: true });
});

configRouter.get('/tab-order/:profileId', (req, res) => {
  res.json({ order: getTabOrder(req.userId!, req.params.profileId) ?? null });
});

configRouter.put('/tab-order/:profileId', (req, res) => {
  const order = req.body?.order as StartupSectionId[] | undefined;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: 'order (array) is required.' });
    return;
  }
  setTabOrder(req.userId!, req.params.profileId, order);
  res.json({ ok: true });
});

// --- Spin wheels --------------------------------------------------------------
// Unlike every other route in this file, a wheel isn't strictly scoped to
// the calling user's own data - one marked `shared` (src/lib/wheels.ts)
// is deliberately visible to, and per the user's own explicit choice,
// fully editable by every other user on this instance too. GET returns
// the caller's own wheels plus everyone else's shared ones; PUT/DELETE
// operate on one wheel at a time (not a whole-array replace like
// Profiles above) since a shared wheel needs to be resolved to wherever
// it actually lives, which store.ts's saveWheel/deleteWheel handle.

configRouter.get('/wheels/:profileId', (req, res) => {
  res.json(getVisibleWheels(req.userId!, req.params.profileId));
});

configRouter.put('/wheels/:profileId/:wheelId', (req, res) => {
  const wheel = req.body as Wheel;
  if (!wheel || wheel.id !== req.params.wheelId) {
    res.status(400).json({ error: 'A wheel body matching the URL id is required.' });
    return;
  }
  const ok = saveWheel(req.userId!, req.params.profileId, wheel);
  if (!ok) {
    res.status(403).json({ error: "That wheel isn't yours and isn't shared." });
    return;
  }
  res.json({ ok: true });
});

configRouter.delete('/wheels/:profileId/:wheelId', (req, res) => {
  const ok = deleteWheel(req.userId!, req.params.wheelId);
  if (!ok) {
    res.status(403).json({ error: "That wheel isn't yours and isn't shared." });
    return;
  }
  res.json({ ok: true });
});
