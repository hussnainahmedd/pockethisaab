import { getDb } from './db';

/* ------------------------------------------------------------------ */
/* Remote version info                                                 */
/* ------------------------------------------------------------------ */

const VERSION_URL =
  'https://raw.githubusercontent.com/hussnainahmedd/pockethisaab/main/version.json';
const CHECK_TIMEOUT_MS = 8000;

export interface RemoteVersion {
  latestVersion: string;
  apkUrl: string;
  message: string;
}

function isValidRemoteVersion(v: unknown): v is RemoteVersion {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.latestVersion === 'string' &&
    typeof r.apkUrl === 'string' &&
    typeof r.message === 'string'
  );
}

/**
 * Compare two semver-ish version strings ("1.0.2" vs "1.0.10").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.trim().split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.trim().split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Fetch the remote version.json. Silent failure: returns null when offline,
 * on timeout, or on any malformed response. The app must keep working 100%
 * offline, so this never throws.
 */
export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(VERSION_URL, { signal: controller.signal });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      return isValidRemoteVersion(json) ? json : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null; // offline, timeout, DNS, bad JSON — all silent
  }
}

/**
 * Returns the remote version info only when it is NEWER than the app's own
 * version. Returns null otherwise (up to date, offline, or error).
 */
export async function checkForUpdate(
  currentVersion: string,
): Promise<RemoteVersion | null> {
  const remote = await fetchRemoteVersion();
  if (!remote) return null;
  return compareSemver(remote.latestVersion, currentVersion) > 0 ? remote : null;
}

/* ------------------------------------------------------------------ */
/* "Don't nag" state — remember the last version we prompted about     */
/* ------------------------------------------------------------------ */

const PROMPTED_KEY = 'update_prompted_version';

export async function getLastPromptedVersion(): Promise<string | null> {
  try {
    const row = await getDb().getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      [PROMPTED_KEY],
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setLastPromptedVersion(version: string): Promise<void> {
  try {
    await getDb().runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [PROMPTED_KEY, version],
    );
  } catch {
    // non-fatal: worst case the user sees the prompt once more
  }
}
