import { Text, View } from 'react-native';
import { C } from './theme';
import { Chip } from './ui';
import { MoneyError, parseMoneyToMinor } from '../lib/finance/money';
import type { Classification, Wallet } from '../lib/finance/types';

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  income: 'Income',
  expense: 'Expense',
  fee: 'Fee',
  transfer: 'Transfer',
  loan_lent: 'Udhaar given',
  loan_borrowed: 'Udhaar taken',
  repayment_received: 'Repayment received',
  repayment_made: 'Repayment made',
  refund_received: 'Refund received',
  refund_issued: 'Refund issued',
  balance_adjustment: 'Balance adjustment',
  opening_balance: 'Opening balance',
};

/** Parse a user amount string into integer paisa, or return an error message. */
export function parseAmountInput(text: string): { minor: number } | { error: string } {
  try {
    return { minor: parseMoneyToMinor(text) };
  } catch (e) {
    return { error: e instanceof MoneyError ? e.message : 'Invalid amount.' };
  }
}

/** Signed variant for opening balances / adjustments (allows a leading '-'). */
export function parseSignedAmountInput(text: string): { minor: number } | { error: string } {
  const t = text.trim();
  if (t.startsWith('-')) {
    const inner = parseAmountInput(t.slice(1));
    if ('error' in inner) return inner;
    return { minor: -inner.minor };
  }
  return parseAmountInput(t);
}

export function isValidDateInput(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return dateInputOf(d.getTime()) === text;
}

/** YYYY-MM-DD (local) for an epoch-ms instant. */
export function dateInputOf(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayInput(): string {
  return dateInputOf(Date.now());
}

/** Local date at noon → epoch ms (timezone-edge safe). */
export function msOfDateInput(text: string): number {
  return new Date(`${text}T12:00:00`).getTime();
}

export function WalletChips({
  wallets,
  value,
  onChange,
  excludeId,
}: {
  wallets: Wallet[];
  value: string | null;
  onChange: (id: string) => void;
  excludeId?: string;
}) {
  const options = wallets.filter((w) => w.id !== excludeId);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Wallet</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {options.map((w) => (
          <Chip key={w.id} label={w.name} emoji={w.icon ?? undefined} selected={value === w.id} onPress={() => onChange(w.id)} />
        ))}
      </View>
    </View>
  );
}
