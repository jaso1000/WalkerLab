// At-rest encryption for the credential store file. Uses Node's built-in
// `crypto` module only (no expo-crypto/crypto-js - those are client-only and
// unavailable/unneeded server-side). AES-256-GCM rather than the client's
// existing backup feature's CBC (see src/lib/backupCrypto.ts) - GCM's auth
// tag detects tampering/corruption explicitly, which matters more for a
// long-lived store file than for a one-shot passphrase export where a failed
// JSON.parse already doubles as an adequate integrity check.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // AES-256
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // recommended for GCM

export interface EncryptedEnvelope {
  salt: string; // hex
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex
}

// PBKDF2 at 100k iterations takes tens of milliseconds - fine for the one
// decrypt() call at boot, but store.ts's save() (and therefore encrypt())
// runs on every single write, including touchSession() on every
// authenticated request. The master key is already a random 32-byte value
// with nothing to stretch (PBKDF2 exists to strengthen a guessable
// *password*), so the slow derivation buys no real security here - it's
// cached instead, keyed by salt, so it only actually runs once per distinct
// salt. In practice that means once per process lifetime: decrypt() at boot
// seeds the cache from the store file's existing salt, and encrypt() reuses
// whatever salt is already cached rather than minting a new one on every
// save (a fresh IV, generated per call below, is what GCM actually needs to
// stay unique - the salt does not need to rotate per write for that).
let cachedSalt: Buffer | undefined;
let cachedKey: Buffer | undefined;

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  if (cachedSalt && cachedKey && cachedSalt.equals(salt)) {
    return cachedKey;
  }
  const key = crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  cachedSalt = salt;
  cachedKey = key;
  return key;
}

export function encrypt(masterKey: Buffer, plaintext: string): EncryptedEnvelope {
  const salt = cachedSalt ?? crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterKey, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

// Throws if the auth tag doesn't verify (wrong key or corrupted/tampered
// file) - unlike the client's CBC scheme, this is a real cryptographic
// integrity check, not an incidental JSON.parse failure.
export function decrypt(masterKey: Buffer, envelope: EncryptedEnvelope): string {
  const salt = Buffer.from(envelope.salt, 'hex');
  const iv = Buffer.from(envelope.iv, 'hex');
  const authTag = Buffer.from(envelope.authTag, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertext, 'hex');
  const key = deriveKey(masterKey, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
