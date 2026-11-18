// Passphrase-based encryption for Server Profiles' backup/restore feature
// (see `profileBackup.ts` for what actually gets bundled into the payload).
// `expo-crypto` supplies a real CSPRNG for the salt/IV while `crypto-js`
// (pure JS, no native linking) handles the cipher math, so no native rebuild
// is needed for this feature to work.
//
// Two backup formats exist:
// - v1 (every backup made before 2026-11-18): AES-256-CBC, key from PBKDF2
//   at 10k iterations, no integrity check - a wrong passphrase or a damaged
//   code was only caught by the decrypted bytes failing to parse.
// - v2 (everything created now): same cipher, but PBKDF2-SHA256 at 5x the
//   iterations, separate encryption and MAC keys, and an HMAC-SHA256 tag
//   over everything (encrypt-then-MAC), so tampering or a wrong passphrase is
//   detected before anything is decrypted. New backups also need a
//   passphrase of at least 8 characters.
// Restore reads both, so old codes keep working; only old app versions can't
// read v2 codes.
import * as Crypto from 'expo-crypto';
import CryptoJS from 'crypto-js';

// crypto-js's PBKDF2 is pure JS on the JS thread (~1s per 10k iterations on
// a phone, slower on the TV), so this is a deliberate cost/benefit point: 5x
// v1's work factor while keeping a TV restore to seconds, not a minute. The
// passphrase-length minimum below does more for brute-force resistance than
// iterations can at this speed.
const V1_PBKDF2_ITERATIONS = 10000;
const V2_PBKDF2_ITERATIONS = 50000;
const KEY_SIZE_WORDS = 256 / 32;
export const MIN_BACKUP_PASSPHRASE_LENGTH = 8;

interface BackupEnvelopeV1 {
  v: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

interface BackupEnvelopeV2 {
  v: 2;
  iter: number;
  salt: string; // hex
  iv: string; // hex
  ciphertext: string; // base64
  mac: string; // hex HMAC-SHA256 over "v2|iter|salt|iv|ciphertext"
}

const NOT_A_BACKUP = "That doesn't look like a WalkerLab backup code.";
const WRONG_PASSPHRASE = 'Incorrect passphrase or corrupted backup.';

// v1's derivation, unchanged so existing codes still restore (crypto-js
// 4.2's default PBKDF2 hasher, SHA-256).
function deriveKeyV1(passphrase: string, salt: CryptoJS.lib.WordArray) {
  return CryptoJS.PBKDF2(passphrase, salt, { keySize: KEY_SIZE_WORDS, iterations: V1_PBKDF2_ITERATIONS });
}

// One PBKDF2 run, then two independent subkeys via HMAC - cheaper than
// asking PBKDF2 for 64 bytes (which would run the whole iteration count
// twice) and keeps the encryption and MAC keys separate.
function deriveKeysV2(passphrase: string, salt: CryptoJS.lib.WordArray, iterations: number) {
  const master = CryptoJS.PBKDF2(passphrase, salt, {
    keySize: KEY_SIZE_WORDS,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  return {
    encKey: CryptoJS.HmacSHA256('walkerlab-backup-v2-enc', master),
    macKey: CryptoJS.HmacSHA256('walkerlab-backup-v2-mac', master),
  };
}

function macInput(iter: number, salt: string, iv: string, ciphertext: string): string {
  return `v2|${iter}|${salt}|${iv}|${ciphertext}`;
}

// Compares two hex strings without bailing at the first differing character.
function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Encrypts an arbitrary JSON-serializable payload (a profile's full config)
// under the given passphrase and returns a self-contained JSON string (the
// "backup code") that `decryptPayload` can reverse given the same passphrase.
export async function encryptPayload(passphrase: string, payload: unknown): Promise<string> {
  if (passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    throw new Error(`Use a passphrase of at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters.`);
  }
  // Real CSPRNG (native platform random source) for the salt/IV.
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const salt = CryptoJS.lib.WordArray.create(saltBytes);
  const iv = CryptoJS.lib.WordArray.create(ivBytes);

  const iter = V2_PBKDF2_ITERATIONS;
  const { encKey, macKey } = deriveKeysV2(passphrase, salt, iter);
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), encKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const saltHex = salt.toString(CryptoJS.enc.Hex);
  const ivHex = iv.toString(CryptoJS.enc.Hex);
  const ciphertext = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const envelope: BackupEnvelopeV2 = {
    v: 2,
    iter,
    salt: saltHex,
    iv: ivHex,
    ciphertext,
    mac: CryptoJS.HmacSHA256(macInput(iter, saltHex, ivHex, ciphertext), macKey).toString(CryptoJS.enc.Hex),
  };
  return JSON.stringify(envelope);
}

function decryptV1(passphrase: string, envelope: BackupEnvelopeV1): string {
  const salt = CryptoJS.enc.Hex.parse(envelope.salt);
  const iv = CryptoJS.enc.Hex.parse(envelope.iv);
  const key = deriveKeyV1(passphrase, salt);
  // AES-CBC has no built-in authentication, so a wrong passphrase just
  // decrypts to garbage bytes rather than failing cleanly - the UTF-8 decode
  // and the JSON.parse in decryptPayload double as the integrity check.
  try {
    const bytes = CryptoJS.AES.decrypt(envelope.ciphertext, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

function decryptV2(passphrase: string, envelope: BackupEnvelopeV2): string {
  // Bounds on the stored work factor: a code can't make restore skip the
  // KDF (too low) or hang the app for minutes (too high).
  if (!Number.isInteger(envelope.iter) || envelope.iter < 10000 || envelope.iter > 1000000) {
    throw new Error(NOT_A_BACKUP);
  }
  const salt = CryptoJS.enc.Hex.parse(envelope.salt);
  const iv = CryptoJS.enc.Hex.parse(envelope.iv);
  const { encKey, macKey } = deriveKeysV2(passphrase, salt, envelope.iter);
  const expectedMac = CryptoJS.HmacSHA256(macInput(envelope.iter, envelope.salt, envelope.iv, envelope.ciphertext), macKey).toString(
    CryptoJS.enc.Hex
  );
  if (!equalHex(expectedMac, envelope.mac.toLowerCase())) return '';
  try {
    const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(envelope.ciphertext) });
    const bytes = CryptoJS.AES.decrypt(cipherParams, encKey, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

// Reverses `encryptPayload` for either format: parses the backup-code JSON,
// re-derives the key(s) from the passphrase and embedded salt, and decrypts +
// JSON-parses the result. Throws a user-facing error for a malformed code, a
// wrong passphrase, or a corrupted/tampered code.
export async function decryptPayload<T = unknown>(passphrase: string, envelopeString: string): Promise<T> {
  let envelope: BackupEnvelopeV1 | BackupEnvelopeV2;
  try {
    envelope = JSON.parse(envelopeString.trim());
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  if (!envelope || typeof envelope !== 'object') throw new Error(NOT_A_BACKUP);

  let decrypted: string;
  if (envelope.v === 1 && envelope.salt && envelope.iv && envelope.ciphertext) {
    decrypted = decryptV1(passphrase, envelope);
  } else if (
    envelope.v === 2 &&
    typeof envelope.salt === 'string' &&
    typeof envelope.iv === 'string' &&
    typeof envelope.ciphertext === 'string' &&
    typeof envelope.mac === 'string'
  ) {
    decrypted = decryptV2(passphrase, envelope);
  } else {
    throw new Error(NOT_A_BACKUP);
  }

  if (!decrypted) throw new Error(WRONG_PASSPHRASE);
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    throw new Error(WRONG_PASSPHRASE);
  }
}
