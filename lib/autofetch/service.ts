/**
 * Transaction auto-fetch orchestration.
 *
 * Sources (all on-device, nothing leaves the phone):
 *  1. Native disk queue  — SMS receiver + notification listener append one
 *     JSON file per event, even when the app is killed. Drained on launch.
 *  2. SMS inbox scan    — catches anything the receiver missed (e.g. app was
 *     force-stopped) and powers history import.
 *
 * M4 flow: every parsed event goes to the v2 IMPORT INBOX
 * (lib/finance/repository.ts ingestParsedEvent), which applies layered
 * deduplication and either files it as New, flags it Needs Review /
 * Duplicate, or — only with the user's auto-confirm opt-in AND a
 * high-confidence clean parse — posts it to the ledger immediately.
 * Nothing is posted silently by default, pending/failed parses are
 * never posted, and the old same-amount self-transfer deletion is gone:
 * own-account movements are paired as transfers in the inbox instead.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getMetaValue, setMetaValue } from '../db';
import { identifySmsSender, notifAppLabel, notifInstitutionId, NOTIF_APP_PACKAGES, SMS_SENDER_PATTERNS } from './senders';
import { parseNotificationBody, parseSmsBody, type ParsedTransaction } from './parser';
import { getLedger } from '../finance/appLedger';
import { LedgerRepository } from '../finance/repository';
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
export const META_AUTOCONFIRM = 'af_autoconfirm';

export interface AutofetchResult {
  /** Transactions posted automatically during this run (opt-in only). */
  added: number;
  /** Inbox items now waiting for the user's review. */
  review: number;
  supported: boolean;
  enabled: boolean;
}

/**
 * Push the current JS allowlists to the native components. The native
 * side REPLACES its persisted lists with what JS sends, and it reads
 * them fresh for every event — so calling this on every run heals
 * installs whose persisted list predates an app update (the Faysal
 * DigiBank package added in v1.1.3 never reached already-enabled
 * installs before this resync existed: M1 finding P0-7).
 */
export function syncAllowlists(): void {
  try {
    setNotificationPackages(NOTIF_APP_PACKAGES.map((a) => a.pkg));
    setSmsSenders(SMS_SENDER_PATTERNS);
  } catch {
    // ignore — native not present (Expo Go)
  }
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
    if (on) syncAllowlists();
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
/* Inbox ingestion (M4)                                                */
/*                                                                     */
/* Parsed events are handed to the ledger's import engine, which       */
/* files them in the import inbox with suggestions and a confidence     */
/* score. Auto-confirmation happens ONLY when the user opted in AND     */
/* the item is a clean high-confidence parse (bank reference present,   */
/* no candidates). Everything else waits for the user's review.         */
/* ------------------------------------------------------------------ */

type IngestOutcome = 'imported' | 'review' | 'filed' | 'none';

const runStats = { imported: 0, review: 0 };

async function ingestParsed(p: ParsedTransaction, institutionId: string, excerpt: string): Promise<IngestOutcome> {
  const amountMinor = Math.round(p.amount * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return 'none';
  const ledger = getLedger();
  const { observation, created } = await ledger.ingestParsedEvent({
    source: p.channel,
    institution: p.bankLabel,
    institutionId,
    accountHint: p.accountHint,
    amountMinor,
    direction: p.direction,
    counterparty: p.counterparty || null,
    reference: p.tid,
    occurredAt: p.dateMs,
    parseStatus: p.status,
    categoryKey: p.category,
    incomeSource: p.incomeSource,
    excerpt,
  });
  if (!created) return 'none'; // the same source event delivered again
  if (observation.status === 'needs_review') {
    runStats.review++;
    return 'review';
  }
  if (observation.status === 'new') {
    const autoConfirm = (await getMetaValue(META_AUTOCONFIRM)) === '1';
    if (autoConfirm && LedgerRepository.autoConfirmEligible(observation)) {
      try {
        await ledger.confirmObservation(observation.id);
        runStats.imported++;
        return 'imported';
      } catch {
        runStats.review++;
        return 'review';
      }
    }
    runStats.review++;
    return 'review';
  }
  return 'filed'; // duplicate — filed for visibility, nothing posted
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

async function ingestEvent(ev: QueueEvent): Promise<IngestOutcome> {
  try {
    if (ev.type === 'sms' && ev.address && ev.body) {
      const rule = identifySmsSender(ev.address);
      if (!rule) return 'none';
      const parsed = parseSmsBody(rule, ev.body, ev.date ?? Date.now());
      if (!parsed) return 'none';
      return await ingestParsed(parsed, rule.id, ev.body);
    }
    if (ev.type === 'notification' && ev.packageName) {
      const label = notifAppLabel(ev.packageName);
      const parsed = parseNotificationBody(label, ev.title ?? '', ev.text ?? '', ev.postTime ?? Date.now());
      if (!parsed) return 'none';
      return await ingestParsed(parsed, notifInstitutionId(ev.packageName), `${ev.title ?? ''} ${ev.text ?? ''}`);
    }
  } catch (e) {
    console.warn('autofetch: ingest failed', e);
  }
  return 'none';
}

async function drainQueue(smsOn: boolean, notifOn: boolean): Promise<void> {
  if (!smsOn && !notifOn) return;
  const qdir = getQueueDirPath();
  if (!qdir) return;
  let files: string[] = [];
  try {
    files = await FileSystem.readDirectoryAsync(qdir);
  } catch {
    return;
  }
  let processed = 0;
  for (const f of files) {
    const path = `${qdir}/${f}`;
    try {
      const raw = await FileSystem.readAsStringAsync(path);
      const ev = JSON.parse(raw) as QueueEvent;
      if ((ev.type === 'sms' && !smsOn) || (ev.type === 'notification' && !notifOn)) {
        // Channel is off — drop the event.
      } else {
        await ingestEvent(ev);
      }
    } catch {
      // corrupt file — drop it
    }
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // ignore
    }
    if (++processed > 2000) break; // sanity cap
  }
}

async function scanInbox(): Promise<void> {
  if (!(await hasSmsPermission())) return;
  const since = Number((await getMetaValue(META_LAST_SCAN)) || '0');
  let msgs: { address: string; body: string; date: number }[] = [];
  try {
    msgs = await getInboxSms(since, 500);
  } catch (e) {
    console.warn('autofetch: inbox scan failed', e);
    return;
  }
  for (const m of msgs) {
    try {
      const rule = identifySmsSender(m.address);
      if (!rule) continue;
      const parsed = parseSmsBody(rule, m.body, m.date);
      if (!parsed) continue;
      await ingestParsed(parsed, rule.id, m.body);
    } catch {
      // one bad message never breaks the scan
    }
  }
  await setMetaValue(META_LAST_SCAN, String(Date.now()));
}

/* ------------------------------------------------------------------ */
/* Main entry — call on app launch + on foreground                     */
/* ------------------------------------------------------------------ */

let running = false;

export async function runAutofetch(): Promise<AutofetchResult> {
  const idle: AutofetchResult = { added: 0, review: 0, supported: false, enabled: false };
  try {
    if (Platform.OS !== 'android' || !isAutofetchNativeAvailable()) return idle;
    idle.supported = true;
    // Heal persisted native allowlists on every run (P0-7): packages or
    // senders added by an app update reach already-enabled installs.
    syncAllowlists();
    if ((await getMetaValue(META_ENABLED)) !== '1') return idle;
    idle.enabled = true;
    if (running) return idle;
    running = true;
    runStats.imported = 0;
    runStats.review = 0;
    try {
      const smsOn = (await getMetaValue(META_SMS)) === '1';
      const notifOn = (await getMetaValue(META_NOTIF)) === '1';
      await drainQueue(smsOn, notifOn);
      if (smsOn) await scanInbox();
      idle.added = runStats.imported;
      idle.review = runStats.review;
    } finally {
      running = false;
    }
  } catch (e) {
    console.warn('autofetch: run failed', e);
  }
  return idle;
}
