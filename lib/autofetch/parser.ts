/**
 * Transaction parser for Pakistani bank/wallet SMS + finance-app push
 * notifications. Strict by design: a message becomes a transaction ONLY if
 * it matches a known template. Anything fuzzy returns null (skipped, never
 * guessed) — a missed transaction is recoverable, a wrong one corrupts the
 * hisaab.
 */
import type { SenderRule } from './senders';

export type Direction = 'in' | 'out';

export interface ParsedTransaction {
  amount: number;
  direction: Direction;
  /** merchant / person / description shown in the entry note */
  counterparty: string;
  /** 'JazzCash', 'Faysal Bank', 'NayaPay', … */
  bankLabel: string;
  channel: 'sms' | 'notification';
  /** dedup key when the message carries one (TID / Ref # / Txn ID) */
  tid: string | null;
  /** suggested expense category key */
  category: string;
  /** suggested income source label */
  incomeSource: string;
  /** epoch ms of the transaction */
  dateMs: number;
}

const AMT = '([\\d,]+(?:\\.\\d{1,2})?)';
const RS = '(?:Rs\\.?|PKR)';

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function cleanName(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().replace(/[.,;:|]+$/, '').slice(0, 60);
}

function tidOf(body: string): string | null {
  const m =
    body.match(/TID:\s*([0-9]+)/i) ||
    body.match(/Ref\s*#?\s*:?\s*([0-9]+)/i) ||
    body.match(/Txn\.?\s*ID:\s*([0-9]+)/i) ||
    body.match(/Transaction\s*ID:\s*([0-9]+)/i);
  return m ? m[1] : null;
}

/** Hard reject: OTPs, promos, balance info, helpline spam. Runs first. */
const NON_TXN =
  /(one[\s-]?time password|\botp\b|verification code|verify your|is your code|promo|offer|discount|% off|cashback|download (the|our) app|dial\s*\*|helpline|call \d{3,}|loan|markup|profit rate|statement|available balance is|balance inquiry|blocked|unblocked|congratulations|winner)/i;

function isNonTransaction(body: string): boolean {
  return NON_TXN.test(body);
}

/* ------------------------------------------------------------------ */
/* Category + income-source suggestion                                 */
/* ------------------------------------------------------------------ */

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/(restaurant|resturant|hotel|food|pizza|burger|cafe|cafeteria|refreshme|bakery|sweets|dhaba|biryani|shawarma|mcdonald|kfc|gray mackenzie|kitchen|diner)/i, 'food'],
  [/(pso|shell|total parco|parco|fuel|petrol|diesel|cng)/i, 'transport'],
  [/(uber|careem|indrive|bykea|yangoo|railway|daewoo|bus|metro)/i, 'transport'],
  [/(bundle|recharge|top[\s-]?up|prepaid|postpaid|mobile package)/i, 'recharge'],
  [/(hospital|clinic|pharmacy|medical|doctor|laboratory|dental)/i, 'health'],
  [/(lesco|wapda|ssgc|sngpl|ptcl|utility|electricity|gas bill|water bill|internet bill)/i, 'bills'],
  [/(daraz|mall|mart|store|shop|bazaar|cloth|shoe|brand)/i, 'shopping'],
];

export function suggestCategory(counterparty: string, body: string): string {
  const hay = `${counterparty} ${body}`;
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(hay)) return cat;
  }
  return 'other';
}

export function suggestIncomeSource(body: string): string {
  if (/refund/i.test(body)) return 'Refund';
  if (/salary/i.test(body)) return 'Work';
  if (/gift/i.test(body)) return 'Gift';
  return 'Other';
}

/* ------------------------------------------------------------------ */
/* SMS templates (ordered: specific first, generic last)                */
/* ------------------------------------------------------------------ */

interface SmsTemplate {
  dir: Direction;
  re: RegExp;
  /** counterparty extractor; amount group defaults to 1 */
  cp: (m: RegExpMatchArray) => string;
  amtGroup?: number;
  forceCategory?: string;
}

const SMS_TEMPLATES: SmsTemplate[] = [
  // — JazzCash —
  // "Rs 30.00 received in your JazzCash Mobile Account:03283637461 via Raast. TID: 725981397486"
  {
    dir: 'in',
    re: new RegExp(`${RS}\\s*${AMT}\\s+received\\s+in\\s+your\\s+JazzCash`, 'i'),
    cp: (m) => cleanName(m[0].match(/via\s+([A-Za-z]+)/i)?.[1]) || 'JazzCash',
  },
  // "Rs 285.00 paid to GRAY MACKENZIE RESTURANTS INTERNATIONAL LIMITED on 04-10-2026 at ..."
  {
    dir: 'out',
    re: new RegExp(`${RS}\\s*${AMT}\\s+paid\\s+to\\s+(.+?)\\s+on\\s+\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}`, 'i'),
    cp: (m) => cleanName(m[2]),
  },
  // "Mobile Bundle 3 Day Max for Prepaid number 923264553119 of Rs 201.00 has been purchased on ..."
  {
    dir: 'out',
    re: new RegExp(`(.+?)\\s+of\\s+${RS}\\s*${AMT}\\s+has\\s+been\\s+purchased`, 'i'),
    cp: (m) => cleanName(m[1]),
    amtGroup: 2,
    forceCategory: 'recharge',
  },
  // "Rs 1,000.00 sent to MUHAMMAD ALI - 0345... from your JazzCash/Easypaisa Account"
  {
    dir: 'out',
    re: new RegExp(`${RS}\\s*${AMT}\\s+sent\\s+to\\s+(.+?)\\s+(?:from|\\.|$)`, 'i'),
    cp: (m) => cleanName(m[2]?.split('-')[0]),
  },
  // "You have received Rs. 500.00 from 0345... Easypaisa"
  {
    dir: 'in',
    re: new RegExp(`received\\s+${RS}\\s*${AMT}\\s+from\\s+(.+?)(?:\\.|\\s+TID|\\s+Txn|$)`, 'i'),
    cp: (m) => cleanName(m[2]?.split('-')[0]),
  },
  // — FBL / banks —
  // "PKR 400.00 Debit Card purchase at Pso Service Stat from FBL A/C 8588 on ..."
  {
    dir: 'out',
    re: new RegExp(`PKR\\s*${AMT}\\s+Debit Card purchase at\\s+(.+?)\\s+from\\s+`, 'i'),
    cp: (m) => cleanName(m[2]),
  },
  // "PKR 5,000.00 received from Hamza Afzal HBL A/C *3703 via RAAST in FBL A/C *8588 on ..."
  {
    dir: 'in',
    re: new RegExp(`PKR\\s*${AMT}\\s+received\\s+from\\s+(.+?)\\s+via\\s+RAAST`, 'i'),
    cp: (m) => cleanName(m[2]),
  },
  // "PKR 2,500.00 transferred to Ahmed Raza from FBL A/C ..."
  {
    dir: 'out',
    re: new RegExp(`PKR\\s*${AMT}\\s+transferred\\s+to\\s+(.+?)\\s+from\\s+`, 'i'),
    cp: (m) => cleanName(m[2]),
  },
  // — generic bank templates (any allowlisted sender) —
  // "Rs. 850 debited from your account ..."
  {
    dir: 'out',
    re: new RegExp(`${RS}\\s*${AMT}[^.]{0,60}?\\bdebited\\b`, 'i'),
    cp: (m) => cleanName(m[0].match(/\bat\s+(.+?)(?:\s+on|\.|$)/i)?.[1]) || 'Bank',
  },
  // "Rs. 45,000 credited to your account"
  {
    dir: 'in',
    re: new RegExp(`${RS}\\s*${AMT}[^.]{0,60}?\\bcredited\\b`, 'i'),
    cp: (m) => cleanName(m[0].match(/\bfrom\s+(.+?)(?:\s+on|\.|$)/i)?.[1]) || 'Bank',
  },
  // ATM cash withdrawal
  {
    dir: 'out',
    re: new RegExp(`cash\\s+withdrawal[^.]{0,60}?${RS}\\s*${AMT}`, 'i'),
    cp: () => 'ATM Withdrawal',
  },
  {
    dir: 'out',
    re: new RegExp(`${RS}\\s*${AMT}[^.]{0,60}?\\bwithdrawn\\b`, 'i'),
    cp: () => 'ATM Withdrawal',
  },
];

export function parseSmsBody(rule: SenderRule, body: string, dateMs: number): ParsedTransaction | null {
  if (!body || isNonTransaction(body)) return null;
  // Must contain a currency amount at all.
  if (!new RegExp(`${RS}\\s*[\\d,]+`).test(body)) return null;

  for (const t of SMS_TEMPLATES) {
    const m = body.match(t.re);
    if (!m) continue;
    const amount = parseAmount(m[t.amtGroup ?? 1]);
    if (!amount) continue;
    const counterparty = t.cp(m) || rule.label;
    return {
      amount,
      direction: t.dir,
      counterparty,
      bankLabel: rule.label,
      channel: 'sms',
      tid: tidOf(body),
      category: t.forceCategory ?? suggestCategory(counterparty, body),
      incomeSource: suggestIncomeSource(body),
      dateMs,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Push-notification templates (SadaPay / NayaPay / Finja …)            */
/* ------------------------------------------------------------------ */

interface NotifTemplate {
  dir: Direction;
  re: RegExp;
  cp: (m: RegExpMatchArray) => string;
}

const NOTIF_TEMPLATES: NotifTemplate[] = [
  // "Rs 285.00 spent at Gray Mackenzie" / "PKR 500 sent to Ahmed"
  {
    dir: 'out',
    re: new RegExp(`${RS}\\s*${AMT}\\s+(?:spent|paid|sent|debited|deducted)\\s+(?:at|to)\\s+(.+?)(?:\\s+on|\\.|$)`, 'i'),
    cp: (m) => cleanName(m[2]),
  },
  // "You received Rs 5,000.00 from Ahmed Raza"
  {
    dir: 'in',
    re: new RegExp(`received\\s+${RS}\\s*${AMT}\\s+from\\s+(.+?)(?:\\s+on|\\.|$)`, 'i'),
    cp: (m) => cleanName(m[2]),
  },
  // "Rs 5,000.00 received" (no counterparty)
  {
    dir: 'in',
    re: new RegExp(`${RS}\\s*${AMT}\\s+(?:received|credited|deposited)(?:\\s|\\.|$)`, 'i'),
    cp: () => '',
  },
  // "Payment of Rs 300.00 successful at ..."
  {
    dir: 'out',
    re: new RegExp(`(?:payment|transaction)\\s+of\\s+${RS}\\s*${AMT}[^.]{0,60}?\\b(?:successful|completed|done)\\b`, 'i'),
    cp: (m) => cleanName(m[0].match(/\bat\s+(.+?)(?:\s+on|\.|$)/i)?.[1]) || '',
  },
];

export function parseNotificationBody(
  appLabel: string,
  title: string,
  text: string,
  postTime: number,
): ParsedTransaction | null {
  const body = `${title}\n${text}`.trim();
  if (!body || isNonTransaction(body)) return null;
  if (!new RegExp(`${RS}\\s*[\\d,]+`).test(body)) return null;

  for (const t of NOTIF_TEMPLATES) {
    const m = body.match(t.re);
    if (!m) continue;
    const amount = parseAmount(m[1]);
    if (!amount) continue;
    const counterparty = t.cp(m) || appLabel;
    return {
      amount,
      direction: t.dir,
      counterparty,
      bankLabel: appLabel,
      channel: 'notification',
      tid: tidOf(body),
      category: suggestCategory(counterparty, body),
      incomeSource: suggestIncomeSource(body),
      dateMs: postTime,
    };
  }
  return null;
}
