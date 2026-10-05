/**
 * Transaction auto-fetch orchestration.
 *
 * Sources (all on-device, nothing leaves the phone):
 *  1. Native disk queue  — SMS receiver + notification listener append one
 *     JSON file per event, even when the app is killed. Drained on launch.
 *  2. SMS inbox scan    — catches anything the receiver missed (e.g. app was
 *     force-stopped) and powers history import.
 *
 * Every candidate goes through: sender/app allowlist → strict template parse
 * → TID/composite dedup → ledger insert with origin='auto'.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { addExpense, addIncome, hasSeenAutofetch, markAutofetchSeen, getMetaValue, setMetaValue } from '../db';
import { identifySmsSender, notifAppLabel, NOTIF_APP_PACKAGES, SMS_SENDER_PATTERNS } from './senders';
import { parseNotificationBody, parseSmsBody, type ParsedTransaction } from './parser';
import {
  getInboxSms,
  getQueueDirPath,
  isAutofetchNativeAvailable,
  isNotificationListenerEnabled,
  setNotificationPackages,
  setSmsSenders,
  setSmsChannelEnabled as setNativeSmsEnabled,
  setNotifChannelEnabled as setNativeNotifEnabled,
} from '../../modules/transaction-autofetch/src';

export const META_ENABLED = 'af_enabled';
export const META_SMS = 'af_sms_enabled';
export const META_NOTIF = 'af_notif_enabled';
export const META_LAST_SCAN = 'af_last_sms_scan';

export interface AutofetchResult {
  added: number;
  supported: boolean;
  enabled: boolean;
}

/** Local YYYY-MM-DD for an epoch-ms timestamp (Asia/Karachi = device tz). */
export function isoDateLocal(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    return res['android.permission.READ_SMS'] === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function hasNotificationAccess(): boolean {
  return isNotificationListenerEnabled();
}

/* ------------------------------------------------------------------ */
/* Enable / disable                                                    */
/* ------------------------------------------------------------------ */

export async function isAutofetchEnabled(): Promise<boolean> {
  return (await getMetaValue(META_ENABLED)) === '1';
}

export async function setAutofetchEnabled(on: boolean): Promise<void> {
  await setMetaValue(META_ENABLED, on ? '1' : '0');
  try {
    if (on) {
      // Push the allowlists to the native components.
      setNotificationPackages(NOTIF_APP_PACKAGES.map((a) => a.pkg));
      setSmsSenders(SMS_SENDER_PATTERNS);
    }
    // Sync channel toggles so native capture matches the UI state.
    const smsOn = (await getMetaValue(META_SMS)) === '1';
    const notifOn = (await getMetaValue(META_NOTIF)) === '1';
    setNativeSmsEnabled(on && smsOn);
    setNativeNotifEnabled(on && notifOn);
  } catch {
    // ignore — native not present (Expo Go)
  }
}

export async function setSmsChannelEnabled(on: boolean): Promise<void> {
  await setMetaValue(META_SMS, on ? '1' : '0');
  try {
    const masterOn = (await getMetaValue(META_ENABLED)) === '1';
    setNativeSmsEnabled(masterOn && on);
    if (on) setSmsSenders(SMS_SENDER_PATTERNS);
  } catch {
    // ignore — native not present
  }
  if (on) {
    // First enable: only look back 7 days (full history is a manual scan).
    const existing = await getMetaValue(META_LAST_SCAN);
    if (!existing) {
      await setMetaValue(META_LAST_SCAN, String(Date.now() - 7 * 24 * 3600 * 1000));
    }
  }
}

export async function setNotifChannelEnabled(on: boolean): Promise<void> {
  await setMetaValue(META_NOTIF, on ? '1' : '0');
  try {
    const masterOn = (await getMetaValue(META_ENABLED)) === '1';
    setNativeNotifEnabled(masterOn && on);
  } catch {
    // ignore — native not present
  }
}

/* ------------------------------------------------------------------ */
/* Dedup + insert                                                      */
/*                                                                     */
/* Three layers:                                                       */
/*  1. TID key — exact transaction reference, strongest signal.         */
/*  2. Precise fingerprint — bank|amount|direction|date|time|           */
/*     counterparty|salt. The time (HH:MM) distinguishes two legitimate */
/*     same-amount transactions on one day, while receiver/inbox copies */
/*     of one SMS share the same timestamp and still collapse.         */
/*  3. Cross-channel window keys — coarser bank|amount|direction|date|  */
/*     counterparty|15-min-bucket keys, checked for the bucket before,  */
/*     current, and after the event. Catches the same transaction seen  */
/*     as both an SMS and a push notification (timestamps differ by     */
/*     seconds/minutes, never share a TID).                            */
/* ------------------------------------------------------------------ */

function hashStr(raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** HH:MM in device-local time. */
function timePart(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function normCounterparty(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** All dedup keys for a parsed transaction (without salt for window keys). */
function dedupKeys(p: ParsedTransaction, salt: string): string[] {
  if (p.tid) return [`tid:${p.tid}`];
  const date = isoDateLocal(p.dateMs);
  const cp = normCounterparty(p.counterparty);
  const precise = `fp:${hashStr(`${p.bankLabel}|${p.amount}|${p.direction}|${date}|${timePart(p.dateMs)}|${cp}|${salt}`)}`;
  // 15-minute buckets; check prev/curr/next to straddle boundaries.
  const bucket = Math.floor(p.dateMs / 900000);
  const windows = [bucket - 1, bucket, bucket + 1].map(
    (b) => `wx:${hashStr(`${p.bankLabel}|${p.amount}|${p.direction}|${date}|${cp}|${b}`)}`
  );
  return [precise, ...windows];
}

async function insertIfNew(p: ParsedTransaction, salt: string): Promise<boolean> {
  const keys = dedupKeys(p, salt);
  for (const k of keys) {
    if (await hasSeenAutofetch(k)) return false;
  }
  const date = isoDateLocal(p.dateMs);
  const tag = `⚡ ${p.bankLabel}${p.tid ? ` · TID ${p.tid}` : ''}`;
  const note = `${tag} · ${p.counterparty}`.slice(0, 140);
  if (p.direction === 'in') {
    const source = p.incomeSource === 'Other' ? p.bankLabel : p.incomeSource;
    await addIncome(source, p.amount, note, date, 'auto');
  } else {
    await addExpense(p.amount, p.category, note, date, 'auto');
  }
  for (const k of keys) await markAutofetchSeen(k);
  return true;
}

/* ------------------------------------------------------------------ */
/* Event ingestion                                                     */
/* ------------------------------------------------------------------ */

interface QueueEvent {
  type: 'sms' | 'notification';
  address?: string;
  body?: string;
  date?: number;
  packageName?: string;
  title?: string;
  text?: string;
  postTime?: number;
}

async function ingestEvent(ev: QueueEvent): Promise<boolean> {
  try {
    if (ev.type === 'sms' && ev.address && ev.body) {
      const rule = identifySmsSender(ev.address);
      if (!rule) return false;
      const parsed = parseSmsBody(rule, ev.body, ev.date ?? Date.now());
      if (!parsed) return false;
      return await insertIfNew(parsed, ev.address);
    }
    if (ev.type === 'notification' && ev.packageName) {
      const label = notifAppLabel(ev.packageName);
      const parsed = parseNotificationBody(label, ev.title ?? '', ev.text ?? '', ev.postTime ?? Date.now());
      if (!parsed) return false;
      return await insertIfNew(parsed, ev.packageName);
    }
  } catch (e) {
    console.warn('autofetch: ingest failed', e);
  }
  return false;
}

async function drainQueue(smsOn: boolean, notifOn: boolean): Promise<number> {
  let added = 0;
  if (!smsOn && !notifOn) return 0;
  const qdir = getQueueDirPath();
  if (!qdir) return 0;
  let files: string[] = [];
  try {
    files = await FileSystem.readDirectoryAsync(qdir);
  } catch {
    return 0;
  }
  for (const f of files) {
    const path = `${qdir}/${f}`;
    try {
      const raw = await FileSystem.readAsStringAsync(path);
      const ev = JSON.parse(raw) as QueueEvent;
      if ((ev.type === 'sms' && !smsOn) || (ev.type === 'notification' && !notifOn)) {
        // Channel is off — drop the event.
      } else if (await ingestEvent(ev)) {
        added++;
      }
    } catch {
      // corrupt file — drop it
    }
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // ignore
    }
    if (added > 2000) break; // sanity cap
  }
  return added;
}

async function scanInbox(): Promise<number> {
  let added = 0;
  if (!(await hasSmsPermission())) return 0;
  const since = Number((await getMetaValue(META_LAST_SCAN)) || '0');
  let msgs: { address: string; body: string; date: number }[] = [];
  try {
    msgs = await getInboxSms(since, 500);
  } catch (e) {
    console.warn('autofetch: inbox scan failed', e);
    return 0;
  }
  for (const m of msgs) {
    try {
      const rule = identifySmsSender(m.address);
      if (!rule) continue;
      const parsed = parseSmsBody(rule, m.body, m.date);
      if (!parsed) continue;
      if (await insertIfNew(parsed, m.address)) added++;
    } catch {
      // one bad message never breaks the scan
    }
  }
  await setMetaValue(META_LAST_SCAN, String(Date.now()));
  return added;
}

/* ------------------------------------------------------------------ */
/* Main entry — call on app launch + on foreground                     */
/* ------------------------------------------------------------------ */

let running = false;

export async function runAutofetch(): Promise<AutofetchResult> {
  const idle: AutofetchResult = { added: 0, supported: false, enabled: false };
  try {
    if (Platform.OS !== 'android' || !isAutofetchNativeAvailable()) return idle;
    idle.supported = true;
    if ((await getMetaValue(META_ENABLED)) !== '1') return idle;
    idle.enabled = true;
    if (running) return idle;
    running = true;
    try {
      const smsOn = (await getMetaValue(META_SMS)) === '1';
      const notifOn = (await getMetaValue(META_NOTIF)) === '1';
      idle.added += await drainQueue(smsOn, notifOn);
      if (smsOn) idle.added += await scanInbox();
    } finally {
      running = false;
    }
  } catch (e) {
    console.warn('autofetch: run failed', e);
  }
  return idle;
}
