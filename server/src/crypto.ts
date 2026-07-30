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

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encrypt(masterKey: Buffer, plaintext: string): EncryptedEnvelope {
  const salt = crypto.randomBytes(SALT_LENGTH);
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
