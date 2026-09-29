export function formatRs(amount: number): string {
  const rounded = Math.round(amount);
  return 'Rs ' + rounded.toLocaleString('en-PK');
}

/** Signed display: "-Rs 350" for negatives, "Rs 30,000" otherwise. */
export function formatSignedRs(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded).toLocaleString('en-PK');
  return (rounded < 0 ? '-Rs ' : 'Rs ') + abs;
}

export function localMonthPrefix(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function monthPrefixOf(offsetMonths = 0): string {
  const d = new Date();
  const target = new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1);
  return localMonthPrefix(target); // local time, not UTC
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthTitle(prefix: string): string {
  const [y, m] = prefix.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function shortMonthTitle(prefix: string): string {
  return MONTH_NAMES[Number(prefix.split('-')[1]) - 1];
}

export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const today = todayISO();
  if (iso === today) return 'Today';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const ym = String(yest.getMonth() + 1).padStart(2, '0');
  const yd = String(yest.getDate()).padStart(2, '0');
  if (iso === `${yest.getFullYear()}-${ym}-${yd}`) return 'Yesterday';
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}
