// Passphrase-based encryption for Server Profiles' backup/restore feature
// (see `profileBackup.ts` for what actually gets bundled into the payload).
// Uses AES-256-CBC with a PBKDF2-derived key; `expo-crypto` supplies a real
// CSPRNG for the salt/IV while `crypto-js` (pure JS, no native linking)
// handles the actual cipher math, so no native rebuild is needed for this
// feature to work.
import * as Crypto from 'expo-crypto';
import CryptoJS from 'crypto-js';

// Iteration count balances real brute-force resistance against crypto-js's
// pure-JS (non-hardware-accelerated) PBKDF2 performance on a phone - this
// runs once per backup/restore, not a hot path, so ~1s is an acceptable cost.
const PBKDF2_ITERATIONS = 10000;
const KEY_SIZE_WORDS = 256 / 32;

// Shape of the JSON blob a backup code decodes to: version tag (for future
// format changes) plus the salt/IV/ciphertext needed to reverse the cipher.
interface BackupEnvelope {
  v: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

// Stretches a plaintext passphrase into a 256-bit AES key via PBKDF2, salted
// per-backup so the same passphrase never derives the same key twice.
function deriveKey(passphrase: string, salt: CryptoJS.lib.WordArray) {
  return CryptoJS.PBKDF2(passphrase, salt, { keySize: KEY_SIZE_WORDS, iterations: PBKDF2_ITERATIONS });
}

// Encrypts an arbitrary JSON-serializable payload (a profile's full config)
// under the given passphrase and returns a self-contained JSON string
// (the "backup code") that `decryptPayload` can reverse given the same
// passphrase.
export async function encryptPayload(passphrase: string, payload: unknown): Promise<string> {
  // Real CSPRNG (native platform random source) for the salt/IV - this is
  // the one part of "secure" worth not cutting corners on.
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const salt = CryptoJS.lib.WordArray.create(saltBytes);
  const iv = CryptoJS.lib.WordArray.create(ivBytes);

  const key = deriveKey(passphrase, salt);
  const json = JSON.stringify(payload);
  const encrypted = CryptoJS.AES.encrypt(json, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });

  const envelope: BackupEnvelope = {
    v: 1,
    salt: salt.toString(CryptoJS.enc.Hex),
    iv: iv.toString(CryptoJS.enc.Hex),
    ciphertext: encrypted.toString(),
  };
  return JSON.stringify(envelope);
}

// Reverses `encryptPayload`: parses the backup-code JSON, re-derives the key
// from the given passphrase and the embedded salt, and decrypts + JSON-parses
// the result. Throws a user-facing error for a malformed code, a wrong
// passphrase, or a corrupted ciphertext (see the comment below on why CBC
// can't distinguish those last two cleanly).
export async function decryptPayload<T = unknown>(passphrase: string, envelopeString: string): Promise<T> {
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(envelopeString.trim());
  } catch {
    throw new Error("That doesn't look like a WalkerLab backup code.");
  }
  if (envelope.v !== 1 || !envelope.salt || !envelope.iv || !envelope.ciphertext) {
    throw new Error("That doesn't look like a WalkerLab backup code.");
  }

  const salt = CryptoJS.enc.Hex.parse(envelope.salt);
  const iv = CryptoJS.enc.Hex.parse(envelope.iv);
  const key = deriveKey(passphrase, salt);

  // AES-CBC has no built-in authentication, so a wrong passphrase just
  // decrypts to garbage bytes rather than failing cleanly - both the
  // UTF-8 decode and the JSON.parse below double as an integrity check.
  let decrypted = '';
  try {
    const bytes = CryptoJS.AES.decrypt(envelope.ciphertext, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    decrypted = bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    decrypted = '';
  }

  if (!decrypted) {
    throw new Error('Incorrect passphrase or corrupted backup.');
  }

  try {
    return JSON.parse(decrypted) as T;
  } catch {
    throw new Error('Incorrect passphrase or corrupted backup.');
  }
}
