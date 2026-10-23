/**
 * Passphrase-encrypted backup envelope (M6, Phase 13).
 *
 * Format "PHBK1": PBKDF2-HMAC-SHA256 (100,000 iterations) derives a
 * 256-bit key from the user's passphrase and a random salt; the backup
 * payload is AES-256-CBC encrypted with a random IV. Salt and IV come
 * from an INJECTED random source — the app passes expo-crypto's native
 * RNG, tests pass Node's. CryptoJS WordArray.random() is never used
 * (it throws in the React Native runtime; that bug bricked v1.0.4).
 *
 * The passphrase is never stored anywhere. Lose it and the backup is
 * unrecoverable by design.
 */
import CryptoJS from 'crypto-js';
import type { BackupData } from './repository';

export type RngBytes = (n: number) => Uint8Array;

const MAGIC = 'PHBK1';
const ITERATIONS = 100_000;

function wordArrayFromBytes(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function bytesFromWordArray(wa: CryptoJS.lib.WordArray): Uint8Array {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function b64(bytes: Uint8Array): string {
  return CryptoJS.enc.Base64.stringify(wordArrayFromBytes(bytes));
}

function unb64(text: string): Uint8Array {
  return bytesFromWordArray(CryptoJS.enc.Base64.parse(text));
}

function deriveKey(passphrase: string, salt: Uint8Array): CryptoJS.lib.WordArray {
  return CryptoJS.PBKDF2(passphrase, wordArrayFromBytes(salt), {
    keySize: 256 / 32,
    iterations: ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  });
}

export function encryptBackup(data: BackupData, passphrase: string, rng: RngBytes): string {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Backup passphrase must be at least 8 characters.');
  }
  const salt = rng(16);
  const iv = rng(16);
  const key = deriveKey(passphrase, salt);
  const cipher = CryptoJS.AES.encrypt(JSON.stringify(data), key, {
    iv: wordArrayFromBytes(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const envelope = {
    magic: MAGIC,
    kdf: `PBKDF2-SHA256-${ITERATIONS}`,
    salt: b64(salt),
    iv: b64(iv),
    data: CryptoJS.enc.Base64.stringify(cipher.ciphertext),
  };
  return JSON.stringify(envelope, null, 2);
}

export function decryptBackup(envelopeJson: string, passphrase: string): BackupData {
  let env: { magic?: string; salt?: string; iv?: string; data?: string };
  try {
    env = JSON.parse(envelopeJson) as typeof env;
  } catch {
    throw new Error('This file is not a PocketHisaab backup.');
  }
  if (env.magic !== MAGIC || !env.salt || !env.iv || !env.data) {
    throw new Error('This file is not a PocketHisaab backup.');
  }
  const key = deriveKey(passphrase, unb64(env.salt));
  let plain = '';
  try {
    plain = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(env.data) }),
      key,
      { iv: wordArrayFromBytes(unb64(env.iv)), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
    ).toString(CryptoJS.enc.Utf8);
  } catch {
    // CryptoJS throws "Malformed UTF-8 data" when the key is wrong.
    throw new Error('Wrong passphrase, or the backup file is damaged.');
  }
  if (!plain) throw new Error('Wrong passphrase, or the backup file is damaged.');
  let data: BackupData;
  try {
    data = JSON.parse(plain) as BackupData;
  } catch {
    throw new Error('Wrong passphrase, or the backup file is damaged.');
  }
  if (data.format !== 'pockethisaab-backup') {
    throw new Error('This file is not a PocketHisaab backup.');
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* PIN hashing (app lock) — pure helpers; storage lives in lib/lock.ts */
/* ------------------------------------------------------------------ */

export function hashPin(pin: string, saltHex: string): string {
  return CryptoJS.SHA256(`${saltHex}:${pin}`).toString(CryptoJS.enc.Hex);
}

export function makePinRecord(pin: string, rng: RngBytes): { saltHex: string; hashHex: string } {
  const saltHex = Array.from(rng(16), (b) => b.toString(16).padStart(2, '0')).join('');
  return { saltHex, hashHex: hashPin(pin, saltHex) };
}

export function verifyPin(pin: string, saltHex: string, expectedHashHex: string): boolean {
  return hashPin(pin, saltHex) === expectedHashHex;
}
