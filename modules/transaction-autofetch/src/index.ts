import { Platform } from 'react-native';

/**
 * JS wrapper around the TransactionAutofetch native module.
 * The module is loaded lazily: on iOS / web / Expo Go the native binding
 * doesn't exist, so every function degrades to a safe no-op instead of
 * crashing. Always gate UI on isAutofetchNativeAvailable().
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cached: any = undefined;

function getNative() {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'android') return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core');
    cached = requireNativeModule('TransactionAutofetch');
  } catch {
    cached = null; // Expo Go / dev builds without the module
  }
  return cached;
}

export function isAutofetchNativeAvailable(): boolean {
  return getNative() != null;
}

export interface InboxSms {
  address: string;
  body: string;
  /** epoch ms */
  date: number;
}

/** Read SMS inbox rows newer than `since` (epoch ms). Requires READ_SMS. */
export async function getInboxSms(since: number, maxCount = 500): Promise<InboxSms[]> {
  const mod = getNative();
  if (!mod) return [];
  const rows = await mod.getInboxSms(since, maxCount);
  return (rows as InboxSms[]) ?? [];
}

/** Notification Access is a Settings toggle — check whether our listener is enabled. */
export function isNotificationListenerEnabled(): boolean {
  const mod = getNative();
  if (!mod) return false;
  try {
    return !!mod.isNotificationListenerEnabled();
  } catch {
    return false;
  }
}

/** Open the system Notification Access settings screen. */
export function openNotificationListenerSettings(): void {
  try {
    getNative()?.openNotificationListenerSettings();
  } catch {
    // ignore
  }
}

/** Absolute path of the dir the native queue writer appends event files to. */
export function getQueueDirPath(): string | null {
  const mod = getNative();
  if (!mod) return null;
  try {
    const p = mod.getQueueDirPath() as string;
    return p || null;
  } catch {
    return null;
  }
}

/** Overwrite the finance-app package allowlist used by the notification listener. */
export function setNotificationPackages(pkgs: string[]): void {
  try {
    getNative()?.setNotificationPackages(pkgs);
  } catch {
    // ignore
  }
}

/** Overwrite the coarse SMS sender pre-filter used by the SMS receiver. */
export function setSmsSenders(senders: string[]): void {
  try {
    getNative()?.setSmsSenders(senders);
  } catch {
    // ignore
  }
}

/** Sync the SMS channel toggle so the native receiver stops capturing when off. */
export function setSmsChannelEnabled(on: boolean): void {
  try {
    getNative()?.setSmsChannelEnabled(on);
  } catch {
    // ignore
  }
}

/** Sync the notification channel toggle so the native listener stops when off. */
export function setNotifChannelEnabled(on: boolean): void {
  try {
    getNative()?.setNotifChannelEnabled(on);
  } catch {
    // ignore
  }
}
