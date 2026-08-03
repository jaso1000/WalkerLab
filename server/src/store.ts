// Encrypted-at-rest credential/config store - a single JSON file (not
// SQLite/Postgres: this app's whole data footprint is a handful of profiles
// x 9 services, so a single file means no migration tooling, trivial backup,
// and no native-compile-step dependency to worry about across Docker
// host architectures). Loaded fully into memory on boot, re-encrypted and
// flushed atomically (write to a .tmp file, then rename over the real path)
// on every mutation.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { decrypt, encrypt, EncryptedEnvelope } from './crypto';
import {
  AdminRecord,
  emptyStore,
  NavigationStyle,
  Profile,
  SectionId,
  ServiceConfig,
  ServiceName,
  SessionRecord,
  StartupSectionId,
  StoreFile,
} from './types';

const DATA_DIR = process.env.WALKERLAB_DATA_DIR ?? '/data';
const STORE_PATH = path.join(DATA_DIR, 'walkerlab.enc.json');
const KEY_PATH = path.join(DATA_DIR, 'walkerlab.key');

let masterKey: Buffer;
let data: StoreFile;

// The encryption key: an explicit `WALKERLAB_ENCRYPTION_KEY` env var (base64
// or hex, 32 bytes) if supplied, otherwise a random key generated on first
// boot and persisted alongside the store file (mode 0600) - matches the
// "no config required" default already chosen for the admin account itself.
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

// Call once at server startup, before any route handler runs.
export function initStore() {
  masterKey = loadOrCreateMasterKey();
  if (!fs.existsSync(STORE_PATH)) {
    data = emptyStore();
    save();
    return;
  }
  const envelope = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as EncryptedEnvelope;
  // Merge over emptyStore()'s defaults rather than trusting the decrypted
  // JSON's shape as-is - an existing install's store predates whichever
  // fields got added to StoreFile most recently (confirmed live: an
  // already-running install's store had no `navigationStyle`/`tabOrder`
  // keys at all, since it was created before those fields existed, and
  // every getter here does `data.<field>[profileId]` with no top-level
  // undefined check - this crashed with a 500 rather than falling back to
  // a default). Real fields always win; only genuinely missing keys fall
  // back to their empty default. Prevents the same class of bug for any
  // future new field too.
  data = { ...emptyStore(), ...(JSON.parse(decrypt(masterKey, envelope)) as StoreFile) };
  pruneExpiredSessions();
}

// --- Admin -----------------------------------------------------------------

export function getAdmin(): AdminRecord | undefined {
  return data.admin;
}

export function setAdmin(admin: AdminRecord) {
  data.admin = admin;
  save();
}

// --- Sessions ----------------------------------------------------------------

export function createSession(sessionId: string, expiresAt: Date) {
  data.sessions[sessionId] = { expiresAt: expiresAt.toISOString() };
  save();
}

// Returns the session and refreshes its rolling expiry, or undefined if it
// doesn't exist or has expired (an expired session is also pruned here).
export function touchSession(sessionId: string, extendBy: number): SessionRecord | undefined {
  const record = data.sessions[sessionId];
  if (!record) return undefined;
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    delete data.sessions[sessionId];
    save();
    return undefined;
  }
  record.expiresAt = new Date(Date.now() + extendBy).toISOString();
  save();
  return record;
}

export function deleteSession(sessionId: string) {
  delete data.sessions[sessionId];
  save();
}

export function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [id, record] of Object.entries(data.sessions)) {
    if (new Date(record.expiresAt).getTime() < now) {
      delete data.sessions[id];
      changed = true;
    }
  }
  if (changed) save();
}

// --- Profiles ----------------------------------------------------------------

export function getProfiles(): Profile[] {
  return data.profiles;
}

export function setProfiles(profiles: Profile[]) {
  data.profiles = profiles;
  save();
}

export function getActiveProfileId(): string {
  return data.activeProfileId;
}

export function setActiveProfileId(id: string) {
  data.activeProfileId = id;
  save();
}

// --- Service configs -----------------------------------------------------

export function getServiceConfig(profileId: string, service: ServiceName): ServiceConfig | undefined {
  return data.serviceConfigs[profileId]?.[service];
}

export function setServiceConfig(profileId: string, service: ServiceName, config: ServiceConfig) {
  if (!data.serviceConfigs[profileId]) data.serviceConfigs[profileId] = {};
  data.serviceConfigs[profileId][service] = config;
  save();
}

export function clearServiceConfig(profileId: string, service: ServiceName) {
  delete data.serviceConfigs[profileId]?.[service];
  save();
}

// --- Section names / service enabled / startup screen -----------------------

export function getSectionNameOverrides(profileId: string): Partial<Record<SectionId, string>> {
  return data.sectionNames[profileId] ?? {};
}

export function setSectionNameOverrides(profileId: string, overrides: Partial<Record<SectionId, string>>) {
  data.sectionNames[profileId] = overrides;
  save();
}

export function getServiceEnabledOverrides(profileId: string): Partial<Record<ServiceName, boolean>> {
  return data.serviceEnabled[profileId] ?? {};
}

export function setServiceEnabledOverrides(profileId: string, overrides: Partial<Record<ServiceName, boolean>>) {
  data.serviceEnabled[profileId] = overrides;
  save();
}

export function getStartupScreen(profileId: string): StartupSectionId | undefined {
  return data.startupScreen[profileId];
}

export function setStartupScreen(profileId: string, id: StartupSectionId) {
  data.startupScreen[profileId] = id;
  save();
}

export function getNavigationStyle(profileId: string): NavigationStyle | undefined {
  return data.navigationStyle[profileId];
}

export function setNavigationStyle(profileId: string, style: NavigationStyle) {
  data.navigationStyle[profileId] = style;
  save();
}

export function getTabOrder(profileId: string): StartupSectionId[] | undefined {
  return data.tabOrder[profileId];
}

export function setTabOrder(profileId: string, order: StartupSectionId[]) {
  data.tabOrder[profileId] = order;
  save();
}

// Removes every profile-scoped key for a deleted profile in one place -
// mirrors having to clear storage/serviceEnabled/sectionNames/startupScreen
// individually client-side when a profile is deleted.
export function deleteProfileData(profileId: string) {
  delete data.serviceConfigs[profileId];
  delete data.sectionNames[profileId];
  delete data.serviceEnabled[profileId];
  delete data.startupScreen[profileId];
  delete data.navigationStyle[profileId];
  delete data.tabOrder[profileId];
  save();
}
