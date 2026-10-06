/**
 * Known transaction-SMS senders (Pakistani banks + mobile wallets).
 * A sender only counts if it BOTH matches a rule below AND the message body
 * matches a transaction template in parser.ts — the two gates together keep
 * promos, OTPs and personal messages out of the ledger.
 */

export interface SenderRule {
  id: string;
  label: string;
  match: (sender: string) => boolean;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const SMS_SENDERS: SenderRule[] = [
  { id: 'jazzcash', label: 'JazzCash', match: (s) => { const n = norm(s); return n === '8558' || n.includes('JAZZCASH'); } },
  { id: 'easypaisa', label: 'Easypaisa', match: (s) => norm(s).includes('EASYPAISA') || norm(s) === '3737' },
  { id: 'fbl', label: 'Faysal Bank', match: (s) => { const n = norm(s); return n === '8757' || n.includes('FAYSAL') || /(^|[^A-Z])FBL([^A-Z]|$)/.test(n); } },
  { id: 'hbl', label: 'HBL', match: (s) => /(^|[^A-Z])HBL([^A-Z]|$)/.test(norm(s)) },
  { id: 'mcb', label: 'MCB', match: (s) => /(^|[^A-Z])MCB([^A-Z]|$)/.test(norm(s)) },
  { id: 'ubl', label: 'UBL', match: (s) => /(^|[^A-Z])UBL([^A-Z]|$)/.test(norm(s)) },
  { id: 'meezan', label: 'Meezan Bank', match: (s) => norm(s).includes('MEEZAN') },
  { id: 'allied', label: 'Allied Bank', match: (s) => norm(s).includes('ALLIED') || /(^|[^A-Z])ABL([^A-Z]|$)/.test(norm(s)) },
  { id: 'askari', label: 'Askari Bank', match: (s) => norm(s).includes('ASKARI') },
  { id: 'soneri', label: 'Soneri Bank', match: (s) => norm(s).includes('SONERI') },
  { id: 'bankislami', label: 'BankIslami', match: (s) => norm(s).includes('BANKISLAMI') },
  { id: 'jsbank', label: 'JS Bank', match: (s) => norm(s).includes('JSBANK') },
  { id: 'bop', label: 'Bank of Punjab', match: (s) => /(^|[^A-Z])BOP([^A-Z]|$)/.test(norm(s)) },
  { id: 'nbp', label: 'National Bank', match: (s) => /(^|[^A-Z])NBP([^A-Z]|$)/.test(norm(s)) },
  { id: 'silk', label: 'Silk Bank', match: (s) => norm(s).includes('SILK') },
  { id: 'samba', label: 'Samba Bank', match: (s) => norm(s).includes('SAMBA') },
];

export function identifySmsSender(sender: string): SenderRule | null {
  if (!sender) return null;
  for (const rule of SMS_SENDERS) {
    try {
      if (rule.match(sender)) return rule;
    } catch {
      // ignore a bad rule, keep checking
    }
  }
  return null;
}

/**
 * Coarse sender patterns synced to the native SMS receiver as a pre-filter.
 * Normalized (uppercase, alphanumeric) substrings — the receiver only writes
 * an SMS to the disk queue when the sender contains one of these. The exact
 * SenderRule matching + template parsing still happens in JS afterwards.
 */
export const SMS_SENDER_PATTERNS: string[] = [
  '8558', 'JAZZCASH',
  '3737', 'EASYPAISA',
  '8757', 'FAYSAL', 'FBL',
  'HBL', 'MCB', 'UBL', 'MEEZAN', 'ALLIED', 'ABL',
  'ASKARI', 'SONERI', 'BANKISLAMI', 'JSBANK', 'BOP', 'NBP',
  'SILK', 'SAMBA',
];

/**
 * Finance apps whose *push notifications* carry transactions
 * (these EMIs don't send transaction SMS). The native listener only
 * reads notifications from these packages.
 */
export const NOTIF_APP_PACKAGES: { pkg: string; label: string }[] = [
  { pkg: 'com.nayapay.app', label: 'NayaPay' },
  { pkg: 'com.sadapay.app', label: 'SadaPay' },
  { pkg: 'pk.com.sadapay', label: 'SadaPay' },
  { pkg: 'com.finja.consumer', label: 'Finja' },
  { pkg: 'com.finja.app', label: 'Finja' },
  { pkg: 'com.avanza.ambitwizfbl', label: 'Faysal Bank' }, // Faysal DigiBank (verified Play listing id)
];

export function notifAppLabel(pkg: string): string {
  return NOTIF_APP_PACKAGES.find((a) => a.pkg === pkg)?.label ?? pkg;
}
