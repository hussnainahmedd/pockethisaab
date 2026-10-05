import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import CryptoJS from 'crypto-js';

/* ------------------------------------------------------------------ */
/* Field-level encryption for the offline ledger.                       */
/*                                                                      */
/* Threat model: someone gets the raw SQLite file (lost phone, backup   */
/* extraction, rooted device file read). Text that identifies WHO the   */
/* money relates to — udhaar person names, income sources, notes — is   */
/* AES-256-CBC encrypted with a random IV per value. Amounts and dates   */
/* stay numeric/plaintext so offline totals keep working without        */
/* decrypting the whole database.                                       */
/*                                                                      */
/* The 256-bit key is generated once and kept in expo-secure-store      */
/* (Android Keystore-backed) — never in the database, never in code.    */
/* ------------------------------------------------------------------ */

const KEY_ID = 'pockethisaab-enc-key-v1';
export const ENC_PREFIX = 'enc:v1:';

let cachedKeyHex: string | null = null;

/**
 * Secure random bytes via the native expo-crypto module.
 *
 * NOTE: CryptoJS.lib.WordArray.random() must NOT be used here — it needs
 * WebCrypto (crypto.getRandomValues) or Node (crypto.randomBytes), neither
 * of which exists in the React Native runtime, and it throws instead of
 * falling back. That exact throw bricked v1.0.4 on launch.
 */
function secureRandomWordArray(nBytes: number): CryptoJS.lib.WordArray {
  const bytes = Crypto.getRandomBytes(nBytes);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, nBytes);
}

/** Load the device key, generating + storing it on first launch. */
export async function getEncryptionKey(): Promise<string> {
  if (cachedKeyHex) return cachedKeyHex;
  let stored = await SecureStore.getItemAsync(KEY_ID);
  if (!stored) {
    stored = secureRandomWordArray(32).toString(CryptoJS.enc.Hex);
    await SecureStore.setItemAsync(KEY_ID, stored);
  }
  cachedKeyHex = stored;
  return stored;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/** Encrypt a plaintext string. Already-encrypted values pass through. */
export async function encText(value: string | null): Promise<string | null> {
  if (value == null || isEncrypted(value)) return value;
  const key = await getEncryptionKey();
  const iv = secureRandomWordArray(16);
  const ct = CryptoJS.AES.encrypt(value, CryptoJS.enc.Hex.parse(key), { iv }).toString();
  return ENC_PREFIX + iv.toString(CryptoJS.enc.Base64) + '.' + ct;
}

/**
 * Decrypt a value.
 * - null -> null
 * - plaintext (pre-migration) -> returned as-is
 * - encrypted -> decrypted; null if the key can't decrypt it
 */
export async function decText(value: string | null): Promise<string | null> {
  if (value == null || !isEncrypted(value)) return value;
  try {
    const key = await getEncryptionKey();
    const body = value.slice(ENC_PREFIX.length);
    const dot = body.indexOf('.');
    const iv = CryptoJS.enc.Base64.parse(body.slice(0, dot));
    const ct = body.slice(dot + 1);
    const bytes = CryptoJS.AES.decrypt(ct, CryptoJS.enc.Hex.parse(key), { iv });
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return null;
  }
}
