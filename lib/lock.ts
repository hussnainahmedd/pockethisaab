/**
 * App lock storage (M6). The PIN itself is never stored — only a salted
 * SHA-256 hash (lib/finance/backup.ts) inside expo-secure-store
 * (Android Keystore-backed). Biometric unlock is offered when the
 * device supports it and the user enabled it; the PIN always remains
 * as the fallback.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { makePinRecord, verifyPin } from './finance/backup';

const KEY = 'pockethisaab-lock-v1';

export interface LockState {
  enabled: boolean;
  biometric: boolean;
}

interface Stored {
  saltHex: string;
  hashHex: string;
  biometric: boolean;
}

async function read(): Promise<Stored | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export async function getLockState(): Promise<LockState> {
  const s = await read();
  return { enabled: !!s, biometric: s?.biometric ?? false };
}

export async function setupPin(pin: string, biometric: boolean): Promise<void> {
  const rec = makePinRecord(pin, (n) => Crypto.getRandomBytes(n));
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...rec, biometric }));
}

export async function checkPin(pin: string): Promise<boolean> {
  const s = await read();
  if (!s) return false;
  return verifyPin(pin, s.saltHex, s.hashHex);
}

export async function changePin(oldPin: string, newPin: string): Promise<boolean> {
  const s = await read();
  if (!s || !verifyPin(oldPin, s.saltHex, s.hashHex)) return false;
  const rec = makePinRecord(newPin, (n) => Crypto.getRandomBytes(n));
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...rec, biometric: s.biometric }));
  return true;
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  const s = await read();
  if (!s) return;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...s, biometric: on }));
}

export async function disableLock(pin: string): Promise<boolean> {
  const s = await read();
  if (!s || !verifyPin(pin, s.saltHex, s.hashHex)) return false;
  await SecureStore.deleteItemAsync(KEY);
  return true;
}
