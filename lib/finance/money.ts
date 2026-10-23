/**
 * Exact money handling for PocketHisaab v2.
 *
 * All monetary values inside the v2 ledger are integer paisa (minor units):
 * Rs 1 = 100 paisa. No floating-point value ever represents money in the
 * ledger, the repository, or the reporting layer.
 *
 * Parsing is deliberately strict. The v1 parser accepted inputs such as
 * "0x10" (-> 16), "1e3" (-> 1000) and "1,2,3" (-> 123) and misrounded
 * "1.005" (-> 1). Every one of those is rejected here.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Maximum storable amount: Rs 9,000,000,000,000.00 (9e14 paisa). */
export const MAX_MINOR = 900_000_000_000_000;

/**
 * Strictly parse a user/parser supplied amount string into integer paisa.
 *
 * Accepted: "250", "250.5", "250.50", "1,250.50", " 250 " (trimmed).
 * Rejected: empty, signs, hex/scientific notation, malformed comma groups,
 * more than 2 decimal places, zero (unless allowZero), negatives, and
 * amounts above MAX_MINOR.
 */
export function parseMoneyToMinor(raw: string, opts: { allowZero?: boolean } = {}): number {
  if (typeof raw !== 'string') throw new MoneyError('Amount must be a string.');
  const s = raw.trim();
  if (!s) throw new MoneyError('Amount is empty.');

  // Integer part: either plain digits, or correctly grouped thousands.
  // Fraction part: optional, exactly 1 or 2 digits.
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new MoneyError(`Invalid amount: ${JSON.stringify(raw)}`);

  const rupees = Number(m[1].replace(/,/g, ''));
  const paisa = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const minor = rupees * 100 + paisa;

  if (!Number.isSafeInteger(minor)) throw new MoneyError('Amount is too large.');
  if (minor > MAX_MINOR) throw new MoneyError('Amount exceeds the supported maximum.');
  if (minor === 0 && !opts.allowZero) throw new MoneyError('Amount must be more than zero.');
  return minor;
}

/** Validate a value that is already supposed to be integer paisa. */
export function assertMinor(value: number, opts: { allowZero?: boolean; field?: string } = {}): number {
  const field = opts.field ?? 'amount';
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${field} must be an integer number of paisa.`);
  }
  if (Math.abs(value) > MAX_MINOR) throw new MoneyError(`${field} exceeds the supported maximum.`);
  if (value === 0 && !opts.allowZero) throw new MoneyError(`${field} must not be zero.`);
  return value;
}

/** Convert integer paisa to a rupees number for legacy UI boundaries only. */
export function minorToRupees(minor: number): number {
  assertMinor(minor, { allowZero: true });
  return minor / 100;
}

/**
 * Convert a rupees number coming from a legacy (v1) caller into paisa.
 * Rounds to the nearest paisa — used only at the compatibility boundary,
 * never inside the v2 engine.
 */
export function rupeesToMinor(rupees: number): number {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees)) {
    throw new MoneyError('Amount must be a finite number.');
  }
  const minor = Math.round(rupees * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_MINOR) {
    throw new MoneyError('Amount exceeds the supported maximum.');
  }
  return minor;
}

/** Format integer paisa as "Rs 1,250.50" (paisa shown only when non-zero). */
export function formatMinor(minor: number): string {
  assertMinor(minor, { allowZero: true });
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const rupees = Math.floor(abs / 100);
  const paisa = abs % 100;
  const grouped = rupees.toLocaleString('en-PK');
  return paisa === 0 ? `${sign}Rs ${grouped}` : `${sign}Rs ${grouped}.${String(paisa).padStart(2, '0')}`;
}

/** Signed variant: "+Rs 2,000" / "-Rs 350" / "Rs 0". */
export function formatMinorSigned(minor: number): string {
  assertMinor(minor, { allowZero: true });
  if (minor > 0) return `+${formatMinor(minor)}`;
  return formatMinor(minor);
}
