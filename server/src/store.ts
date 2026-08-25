// Encrypted-at-rest credential/config store - a single JSON file (not
// SQLite/Postgres: this app's whole data footprint is a handful of users x
// profiles x 9 services, so a single file means no migration tooling,
// trivial backup, and no native-compile-step dependency to worry about
// across Docker host architectures). Loaded fully into memory on boot,
// re-encrypted and flushed atomically (write to a .tmp file, then rename
// over the real path) on every mutation.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { decrypt, encrypt, EncryptedEnvelope } from './crypto';
import webpush from 'web-push';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILES,
  emptyStore,
  Profile,
  PushDevice,
  SectionId,
  ServiceConfig,
  ServiceName,
  SessionRecord,
  StartupSectionId,
  StoreFile,
  UserRecord,
  VapidKeys,
  WebhookCallback,
  Wheel,
} from './types';

const DATA_DIR = process.env.WALKERLAB_DATA_DIR ?? '/data';
const STORE_PATH = path.join(DATA_DIR, 'walkerlab.enc.json');
const KEY_PATH = path.join(DATA_DIR, 'walkerlab.key');

let masterKey: Buffer;
let data: StoreFile;

// The encryption key: an explicit `WALKERLAB_ENCRYPTION_KEY` env var (base64
// or hex, 32 bytes) if supplied, otherwise a random key generated on first
// boot and persisted alongside the store file (mode 0600) - matches the
// "no config required" default already chosen for the first admin account.
// Losing this file makes the store unrecoverable, same as losing any
// self-hosted app's local DB; low stakes since every credential can be
// manually re-entered.
function loadOrCreateMasterKey(): Buffer {
  const envKey = process.env.WALKERLAB_ENCRYPTION_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, envKey.length === 64 ? 'hex' : 'base64');
    if (buf.length !== 32) throw new Error('WALKERLAB_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    return buf;
  }
  if (fs.existsSync(KEY_PATH)) {
    return fs.readFileSync(KEY_PATH);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  return key;
}

function atomicWriteSync(filePath: string, contents: string) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, contents, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function save() {
  const envelope = encrypt(masterKey, JSON.stringify(data));
  atomicWriteSync(STORE_PATH, JSON.stringify(envelope));
}

// Shape of a pre-multi-user (v1) store file - kept narrow and local (not in
// types.ts) since it only ever exists transiently, for one read, during
// migrateToV2 below. `admin`/`profiles`/`activeProfileId`/etc. here are the
// old single-admin, global (not per-user) fields StoreFile itself used to
// declare - see git history on types.ts if the exact pre-migration shape
// ever needs double-checking.
interface StoreFileV1 {
  v?: 1;
  admin?: { username: string; passwordHash: string; createdAt: string };
  profiles?: Profile[];
  activeProfileId?: string;
  serviceConfigs?: Record<string, Partial<Record<ServiceName, ServiceConfig>>>;
  sectionNames?: Record<string, Partial<Record<SectionId, string>>>;
  serviceEnabled?: Record<string, Partial<Record<ServiceName, boolean>>>;
  startupScreen?: Record<string, StartupSectionId>;
  tabOrder?: Record<string, StartupSectionId[]>;
}

// Converts a decrypted, parsed JSON blob of unknown vintage into today's
// (v2, multi-user) StoreFile shape. A v2 file (has `users`) passes through
// unchanged. A v1 file (single global admin + global profiles) becomes a
// v2 file with exactly one user - the old admin, now with a real id and
// `role: 'admin'` - and every one of their existing profiles/service
// configs/etc. moved under that new user id, so an existing install keeps
// everything exactly as it was, just now owned by "the first user" instead
// of being global. Old session tokens are deliberately dropped rather than
// migrated (the session shape itself changed to carry a userId, and there's
// no way to know which admin an old anonymous session belonged to that
// isn't already implied by "the only admin that existed") - anyone with an
// old session just has to log in again once, a one-time, low-stakes cost
// for a data-model change like this.
function migrateToV2(decoded: unknown): StoreFile {
  const raw = decoded as StoreFileV1 & { users?: unknown };
  if (raw.users) return decoded as StoreFile;

  const next = emptyStore();
  if (!raw.admin) return next;

  const userId = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const user: UserRecord = {
    id: userId,
    username: raw.admin.username,
    passwordHash: raw.admin.passwordHash,
    role: 'admin',
    createdAt: raw.admin.createdAt,
  };
  next.users[userId] = user;
  next.profiles[userId] = raw.profiles && raw.profiles.length > 0 ? raw.profiles : DEFAULT_PROFILES;
  next.activeProfileId[userId] = raw.activeProfileId ?? DEFAULT_PROFILE_ID;
  next.serviceConfigs[userId] = raw.serviceConfigs ?? {};
  next.sectionNames[userId] = raw.sectionNames ?? {};
  next.serviceEnabled[userId] = raw.serviceEnabled ?? {};
  next.startupScreen[userId] = raw.startupScreen ?? {};
  next.tabOrder[userId] = raw.tabOrder ?? {};
  return next;
}

// Call once at server startup, before any route handler runs.
export function initStore() {
  masterKey = loadOrCreateMasterKey();
  if (!fs.existsSync(STORE_PATH)) {
    data = emptyStore();
    save();
    return;
  }
  const envelope = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as EncryptedEnvelope;
  const decoded = JSON.parse(decrypt(masterKey, envelope));
  // Merge over emptyStore()'s defaults rather than trusting the decrypted
  // JSON's shape as-is - an existing install's store predates whichever
  // fields got added to StoreFile most recently (confirmed live: an
  // already-running install's store had no `tabOrder` key at all, since
  // it was created before that field existed, and every getter here does
  // `data.<field>[userId]` with no top-level undefined check - this
  // crashed with a 500 rather than falling back to a default). Real
  // fields always win; only genuinely missing keys fall back to their
  // empty default. Prevents the same class of bug for any future new
  // field too. migrateToV2 runs first so this merge always sees today's
  // (v2) shape regardless of what was actually on disk.
  data = { ...emptyStore(), ...migrateToV2(decoded) };
  save();
  pruneExpiredSessions();
}

// --- Users -------------------------------------------------------------------

export function getUsers(): UserRecord[] {
  return Object.values(data.users);
}

export function getUserById(id: string): UserRecord | undefined {
  return data.users[id];
}

export function getUserByUsername(username: string): UserRecord | undefined {
  return Object.values(data.users).find((u) => u.username === username);
}

export function hasAnyUsers(): boolean {
  return Object.keys(data.users).length > 0;
}

// Seeds the new user with one real, already-persisted "Home Lab" profile -
// matches how every install (single- or multi-user) has always bootstrapped,
// rather than relying on the client's own DEFAULT_PROFILES fallback, which
// only covers rendering before a real list loads, not persistence.
export function createUser(user: UserRecord) {
  data.users[user.id] = user;
  data.profiles[user.id] = DEFAULT_PROFILES.map((p) => ({ ...p }));
  data.activeProfileId[user.id] = DEFAULT_PROFILE_ID;
  save();
}

export function updateUser(id: string, patch: Partial<UserRecord>) {
  const existing = data.users[id];
  if (!existing) return;
  data.users[id] = { ...existing, ...patch };
  save();
}

// Removes a user and every piece of data scoped to them (profiles, service
// configs, everything - see deleteProfileData's own per-profile version of
// this same idea) plus logs them out of any live session immediately,
// rather than leaving those sessions valid until they naturally expire.
export function deleteUserData(userId: string) {
  delete data.users[userId];
  delete data.profiles[userId];
  delete data.activeProfileId[userId];
  delete data.serviceConfigs[userId];
  delete data.sectionNames[userId];
  delete data.serviceEnabled[userId];
  delete data.startupScreen[userId];
  delete data.tabOrder[userId];
  delete data.wheels[userId];
  delete data.pushDevices[userId];
  delete data.notificationPrefs[userId];
  delete data.notificationWebhookSecrets[userId];
  for (const [sessionId, session] of Object.entries(data.sessions)) {
    if (session.userId === userId) {
      delete data.sessions[sessionId];
      lastPersistedExpiry.delete(sessionId);
    }
  }
  save();
}

// --- Sessions ----------------------------------------------------------------

export function createSession(sessionId: string, userId: string, expiresAt: Date) {
  data.sessions[sessionId] = { userId, expiresAt: expiresAt.toISOString() };
  save();
}

// Tracks, per session, the expiry that was last actually flushed to disk -
// deliberately NOT part of `data` (never persisted itself). Lets
// touchSession below extend a session's real, in-memory expiry on every
// call (so the rolling window is always accurate to any in-process reader)
// while only paying for a full encrypt+rewrite of the store file
// periodically, not on every authenticated request.
const lastPersistedExpiry = new Map<string, number>();
const TOUCH_PERSIST_THRESHOLD_MS = 60 * 60 * 1000; // persist at most ~once/hour/session

// Returns the session and refreshes its rolling expiry, or undefined if it
// doesn't exist or has expired (an expired session is also pruned here).
export function touchSession(sessionId: string, extendBy: number): SessionRecord | undefined {
  const record = data.sessions[sessionId];
  if (!record) return undefined;
  const now = Date.now();
  if (new Date(record.expiresAt).getTime() < now) {
    delete data.sessions[sessionId];
    lastPersistedExpiry.delete(sessionId);
    save();
    return undefined;
  }
  const newExpiresAt = now + extendBy;
  record.expiresAt = new Date(newExpiresAt).toISOString();
  const lastPersisted = lastPersistedExpiry.get(sessionId) ?? 0;
  if (newExpiresAt - lastPersisted > TOUCH_PERSIST_THRESHOLD_MS) {
    lastPersistedExpiry.set(sessionId, newExpiresAt);
    save();
  }
  return record;
}

export function deleteSession(sessionId: string) {
  delete data.sessions[sessionId];
  lastPersistedExpiry.delete(sessionId);
  save();
}

export function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [id, record] of Object.entries(data.sessions)) {
    if (new Date(record.expiresAt).getTime() < now) {
      delete data.sessions[id];
      lastPersistedExpiry.delete(id);
      changed = true;
    }
  }
  if (changed) save();
}

// --- Profiles ----------------------------------------------------------------

export function getProfiles(userId: string): Profile[] {
  return data.profiles[userId] ?? [];
}

export function setProfiles(userId: string, profiles: Profile[]) {
  data.profiles[userId] = profiles;
  save();
}

export function getActiveProfileId(userId: string): string {
  return data.activeProfileId[userId] ?? DEFAULT_PROFILE_ID;
}

export function setActiveProfileId(userId: string, id: string) {
  data.activeProfileId[userId] = id;
  save();
}

// --- Service configs -----------------------------------------------------

export function getServiceConfig(userId: string, profileId: string, service: ServiceName): ServiceConfig | undefined {
  return data.serviceConfigs[userId]?.[profileId]?.[service];
}

export function setServiceConfig(userId: string, profileId: string, service: ServiceName, config: ServiceConfig) {
  if (!data.serviceConfigs[userId]) data.serviceConfigs[userId] = {};
  if (!data.serviceConfigs[userId][profileId]) data.serviceConfigs[userId][profileId] = {};
  data.serviceConfigs[userId][profileId][service] = config;
  save();
}

export function clearServiceConfig(userId: string, profileId: string, service: ServiceName) {
  delete data.serviceConfigs[userId]?.[profileId]?.[service];
  save();
}

// --- Section names / service enabled / startup screen -----------------------

export function getSectionNameOverrides(userId: string, profileId: string): Partial<Record<SectionId, string>> {
  return data.sectionNames[userId]?.[profileId] ?? {};
}

export function setSectionNameOverrides(userId: string, profileId: string, overrides: Partial<Record<SectionId, string>>) {
  if (!data.sectionNames[userId]) data.sectionNames[userId] = {};
  data.sectionNames[userId][profileId] = overrides;
  save();
}

export function getServiceEnabledOverrides(userId: string, profileId: string): Partial<Record<ServiceName, boolean>> {
  return data.serviceEnabled[userId]?.[profileId] ?? {};
}

export function setServiceEnabledOverrides(userId: string, profileId: string, overrides: Partial<Record<ServiceName, boolean>>) {
  if (!data.serviceEnabled[userId]) data.serviceEnabled[userId] = {};
  data.serviceEnabled[userId][profileId] = overrides;
  save();
}

export function getStartupScreen(userId: string, profileId: string): StartupSectionId | undefined {
  return data.startupScreen[userId]?.[profileId];
}

export function setStartupScreen(userId: string, profileId: string, id: StartupSectionId) {
  if (!data.startupScreen[userId]) data.startupScreen[userId] = {};
  data.startupScreen[userId][profileId] = id;
  save();
}

export function getTabOrder(userId: string, profileId: string): StartupSectionId[] | undefined {
  return data.tabOrder[userId]?.[profileId];
}

export function setTabOrder(userId: string, profileId: string, order: StartupSectionId[]) {
  if (!data.tabOrder[userId]) data.tabOrder[userId] = {};
  data.tabOrder[userId][profileId] = order;
  save();
}

// --- Spin wheels --------------------------------------------------------------
// Wheels are per-profile like everything else here, but with one added
// twist: a wheel can be marked `shared`, making it visible to (and, per
// the user's explicit choice, editable/deletable by) every OTHER user on
// this instance too - the one piece of user data in this whole store
// that's allowed to cross the userId boundary the rest of this file is so
// careful about, and only when its owner opted in via that flag.

// Every wheel visible to `userId` for `profileId`: their own (regardless
// of `shared`) plus every other user's wheel marked `shared`, wherever it
// actually lives. Cheap to scan in full - this is a self-hosted instance
// with a handful of users/wheels, not a multi-tenant service.
export function getVisibleWheels(userId: string, profileId: string): Wheel[] {
  const own = data.wheels[userId]?.[profileId] ?? [];
  const sharedFromOthers: Wheel[] = [];
  for (const [otherUserId, profiles] of Object.entries(data.wheels)) {
    if (otherUserId === userId) continue;
    for (const wheels of Object.values(profiles)) {
      for (const wheel of wheels) {
        if (wheel.shared) sharedFromOthers.push(wheel);
      }
    }
  }
  return [...own, ...sharedFromOthers];
}

// Scans every user's every profile for a wheel with this id - needed
// because a shared wheel can be edited/deleted by someone who doesn't
// know (and has no reason to know) which user actually owns it.
function findWheelLocation(wheelId: string): { userId: string; profileId: string; index: number } | undefined {
  for (const [ownerUserId, profiles] of Object.entries(data.wheels)) {
    for (const [profileId, wheels] of Object.entries(profiles)) {
      const index = wheels.findIndex((w) => w.id === wheelId);
      if (index !== -1) return { userId: ownerUserId, profileId, index };
    }
  }
  return undefined;
}

// Creates (if `wheel.id` doesn't exist anywhere yet) or updates a single
// wheel. A new wheel is always created under the calling user's own
// `profileId`. Updating an existing one is allowed if the caller already
// owns it, OR if it's currently marked `shared` (in which case it's
// updated in place under its real owner, not moved) - any other case
// (someone else's wheel that isn't shared) is refused. Returns false on
// refusal so the route can turn that into a 403 rather than silently
// succeeding.
export function saveWheel(userId: string, profileId: string, wheel: Wheel): boolean {
  const location = findWheelLocation(wheel.id);
  if (!location) {
    if (!data.wheels[userId]) data.wheels[userId] = {};
    if (!data.wheels[userId][profileId]) data.wheels[userId][profileId] = [];
    data.wheels[userId][profileId].push(wheel);
    save();
    return true;
  }
  const owningList = data.wheels[location.userId][location.profileId];
  const existing = owningList[location.index];
  if (location.userId !== userId && !existing.shared) return false;
  owningList[location.index] = wheel;
  save();
  return true;
}

// Same ownership-or-shared rule as saveWheel - returns false (route turns
// this into a 403) rather than silently no-op-ing on a refusal, so the
// client can tell "already gone" apart from "not allowed to."
export function deleteWheel(userId: string, wheelId: string): boolean {
  const location = findWheelLocation(wheelId);
  if (!location) return true; // already gone - deleting it again is a no-op success
  const owningList = data.wheels[location.userId][location.profileId];
  const existing = owningList[location.index];
  if (location.userId !== userId && !existing.shared) return false;
  owningList.splice(location.index, 1);
  save();
  return true;
}

// Removes every profile-scoped key for one deleted profile (within a user's
// own data) - mirrors having to clear storage/serviceEnabled/sectionNames/
// startupScreen individually client-side when a profile is deleted.
// `pushDevices` is deliberately NOT touched here - it's keyed by userId
// only (delivery is per-user, not per-profile), so a profile deletion
// leaves registered devices alone.
export function deleteProfileData(userId: string, profileId: string) {
  delete data.serviceConfigs[userId]?.[profileId];
  delete data.sectionNames[userId]?.[profileId];
  delete data.serviceEnabled[userId]?.[profileId];
  delete data.startupScreen[userId]?.[profileId];
  delete data.tabOrder[userId]?.[profileId];
  delete data.wheels[userId]?.[profileId];
  delete data.notificationPrefs[userId]?.[profileId];
  delete data.notificationWebhookSecrets[userId]?.[profileId];
  save();
}

// --- Push notifications -------------------------------------------------

// Upserts by the subscription's own stable identifier (its endpoint) -
// re-registering the same browser (e.g. an app relaunch or a re-subscribe)
// updates its profileId/registeredAt in place rather than accumulating
// duplicate entries for the same physical browser.
export function registerPushDevice(userId: string, device: Omit<PushDevice, 'registeredAt'>) {
  const existing = data.pushDevices[userId] ?? [];
  const full: PushDevice = { ...device, registeredAt: new Date().toISOString() };
  data.pushDevices[userId] = [...existing.filter((d) => d.subscription.endpoint !== full.subscription.endpoint), full];
  save();
}

export function getPushDevices(userId: string): PushDevice[] {
  return data.pushDevices[userId] ?? [];
}

// Called when a send comes back 404/410 (Gone) - the browser's own
// subscription has expired or been revoked, and will fail identically
// forever until removed. Without this, a stale subscription just fails
// silently on every future notification with no way for the user to
// notice - confirmed live this session (real FCM 410s in the server log,
// no visible symptom on the client at all).
export function removePushDevice(userId: string, endpoint: string) {
  const existing = data.pushDevices[userId];
  if (!existing) return;
  data.pushDevices[userId] = existing.filter((d) => d.subscription.endpoint !== endpoint);
  save();
}

export function getNotificationPrefs(userId: string, profileId: string): Partial<Record<ServiceName, boolean>> {
  return data.notificationPrefs[userId]?.[profileId] ?? {};
}

export function setNotificationPrefs(userId: string, profileId: string, prefs: Partial<Record<ServiceName, boolean>>) {
  if (!data.notificationPrefs[userId]) data.notificationPrefs[userId] = {};
  data.notificationPrefs[userId][profileId] = prefs;
  save();
}

// Lazily creates a webhook secret for this user/profile/service the first
// time it's needed (turning that service's notification toggle on),
// instead of generating one for every service up front - most users will
// only ever enable a subset.
export function getOrCreateNotificationWebhookSecret(userId: string, profileId: string, service: ServiceName): string {
  const existing = data.notificationWebhookSecrets[userId]?.[profileId]?.[service];
  if (existing) return existing;
  const secret = crypto.randomBytes(24).toString('hex');
  if (!data.notificationWebhookSecrets[userId]) data.notificationWebhookSecrets[userId] = {};
  if (!data.notificationWebhookSecrets[userId][profileId]) data.notificationWebhookSecrets[userId][profileId] = {};
  data.notificationWebhookSecrets[userId][profileId][service] = secret;
  save();
  return secret;
}

// Used by the (unauthenticated, secret-in-URL) webhook receiver to
// validate an inbound request - never creates one, unlike the getter above.
export function getNotificationWebhookSecret(userId: string, profileId: string, service: ServiceName): string | undefined {
  return data.notificationWebhookSecrets[userId]?.[profileId]?.[service];
}

// This server instance's own Web Push identity - generated once, on first
// use, and persisted (not per-user, see VapidKeys' own comment in
// types.ts). Every web push send (notificationRoutes.ts) needs this.
export function getOrCreateVapidKeys(): VapidKeys {
  if (data.vapidKeys) return data.vapidKeys;
  const keys = webpush.generateVAPIDKeys();
  data.vapidKeys = keys;
  save();
  return keys;
}

// How Sonarr/Radarr/Lidarr/Overseerr should reach this instance's webhook
// receiver - see WebhookCallback's own comment in types.ts. Unlike
// getOrCreateVapidKeys, there's no sensible default to lazily generate;
// null until the user explicitly sets it (notificationRoutes.ts's
// webhookUrl() treats null as "not configured yet" and omits that
// service's webhook URL rather than falling back to a guess).
export function getWebhookCallback(): WebhookCallback | null {
  return data.webhookCallback;
}

export function setWebhookCallback(callback: WebhookCallback) {
  data.webhookCallback = callback;
  save();
}
