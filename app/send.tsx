import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, Chip, Field, PrimaryButton } from '../components/ui';
import { WalletChips, isValidDateInput, msOfDateInput, parseAmountInput, todayInput } from '../components/finance';
import { getLedger } from '../lib/finance/appLedger';
import { formatMinor } from '../lib/finance/money';
import type { Category, Loan, Wallet } from '../lib/finance/types';

type Purpose = 'expense' | 'lend' | 'repayment' | 'transfer' | 'fee' | 'refund';

const PURPOSES: { key: Purpose; label: string }[] = [
  { key: 'expense', label: '💸 Expense' },
  { key: 'lend', label: '🤝 Udhaar given' },
  { key: 'repayment', label: '↩️ Udhaar repayment' },
  { key: 'transfer', label: '🔁 Wallet transfer' },
  { key: 'fee', label: '🏷️ Fee / charges' },
  { key: 'refund', label: '🧾 Refund issued' },
];

export default function SendScreen() {
  const ledger = getLedger();
  const [purpose, setPurpose] = useState<Purpose>('expense');
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [borrowedLoans, setBorrowedLoans] = useState<(Loan & { remainingMinor: number })[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [toWalletId, setToWalletId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loanId, setLoanId] = useState<string | null>(null);
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput());
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, cats, loans] = await Promise.all([ledger.listWallets(), ledger.listCategories(), ledger.listLoans()]);
    setWallets(w);
    setCategories(cats);
    setWalletId((prev) => prev ?? w[0]?.id ?? null);
    const open = loans.filter((l) => l.direction === 'borrowed' && l.status !== 'void' && l.status !== 'settled');
    const detailed: (Loan & { remainingMinor: number })[] = [];
    for (const l of open) detailed.push({ ...l, remainingMinor: await ledger.getLoanRemainingMinor(l.id) });
    setBorrowedLoans(detailed.filter((l) => l.remainingMinor > 0));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const submit = async () => {
    const parsed = parseAmountInput(amount);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    if (!isValidDateInput(date)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD with a real calendar date.');
    if (dueDate && !isValidDateInput(dueDate)) return Alert.alert('Invalid due date', 'Use YYYY-MM-DD or leave it empty.');
    if (!walletId) return Alert.alert('Pick a wallet', 'Choose the wallet the money leaves from.');
    const base = {
      occurredAt: msOfDateInput(date),
      note: note.trim() || null,
      reference: reference.trim() || null,
    };
    setBusy(true);
    try {
      if (purpose === 'expense') {
        await ledger.addExpense({ walletId, amountMinor: parsed.minor, categoryId, counterparty: person.trim() || null, ...base });
      } else if (purpose === 'fee') {
        await ledger.addFee({ walletId, amountMinor: parsed.minor, counterparty: person.trim() || null, ...base });
      } else if (purpose === 'refund') {
        await ledger.addRefundIssued({ walletId, amountMinor: parsed.minor, counterparty: person.trim() || null, ...base });
      } else if (purpose === 'lend') {
        if (!person.trim()) throw new Error('Enter the person you are lending to.');
        await ledger.lend({ personName: person.trim(), phone: phone.trim() || null, walletId, amountMinor: parsed.minor, dueDate: dueDate || null, ...base });
      } else if (purpose === 'repayment') {
        if (!loanId) throw new Error('Pick the borrowed udhaar you are repaying.');
        await ledger.recordRepayment({ loanId, walletId, amountMinor: parsed.minor, ...base });
      } else if (purpose === 'transfer') {
        if (!toWalletId) throw new Error('Pick the destination wallet.');
        await ledger.transfer({ fromWalletId: walletId, toWalletId, amountMinor: parsed.minor, ...base });
      }
      Alert.alert('Recorded', `${formatMinor(parsed.minor)} sent · ${PURPOSES.find((p) => p.key === purpose)?.label}. PocketHisaab records movements — it does not move real money.`);
      router.back();
    } catch (e) {
      Alert.alert('Could not record', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>Send money</Text>
        <Text style={s.sub}>Record money leaving a wallet — and what it really is. The purpose decides the accounting, not just the direction.</Text>
        <Card style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Purpose</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
            {PURPOSES.map((p) => (
              <Chip key={p.key} label={p.label} selected={purpose === p.key} onPress={() => setPurpose(p.key)} />
            ))}
          </View>
          <WalletChips wallets={wallets} value={walletId} onChange={setWalletId} />
          {purpose === 'transfer' && (
            <>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Destination wallet</Text>
              <WalletChips wallets={wallets} value={toWalletId} onChange={setToWalletId} excludeId={walletId ?? undefined} />
            </>
          )}
          {purpose === 'expense' && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Category</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {categories.filter((c) => c.kind === 'expense' || c.kind === 'both').map((c) => (
                  <Chip key={c.id} label={c.name} emoji={c.icon ?? undefined} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
                ))}
                <Chip label="None" selected={categoryId === null} onPress={() => setCategoryId(null)} />
              </View>
            </View>
          )}
          {purpose === 'repayment' && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Which borrowed udhaar?</Text>
              {borrowedLoans.length === 0 ? (
                <Text style={{ color: C.inkSoft, fontSize: 13.5 }}>You have no open borrowed udhaar to repay.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {borrowedLoans.map((l) => (
                    <Chip
                      key={l.id}
                      label={`${l.personName} · ${formatMinor(l.remainingMinor)} left`}
                      selected={loanId === l.id}
                      onPress={() => setLoanId(l.id)}
                    />
                  ))}
                </View>
              )}
            </View>
          )}
          {(purpose === 'expense' || purpose === 'fee' || purpose === 'refund') && (
            <Field label="Recipient / counterparty" value={person} onChangeText={setPerson} placeholder="Who received it? (optional)" />
          )}
          {purpose === 'lend' && (
            <>
              <Field label="Person" value={person} onChangeText={setPerson} placeholder="Who are you lending to?" autoCapitalize="words" />
              <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="03xx xxxxxxx" keyboardType="numeric" />
              <Field label="Due date (optional, YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder="2026-11-15" />
            </>
          )}
          <Field label="Amount (Rs)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="e.g. 1500" />
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          <Field label="Reference (optional)" value={reference} onChangeText={setReference} placeholder="Bank / wallet reference" />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
          <PrimaryButton title={busy ? 'Recording…' : 'Record send'} onPress={submit} disabled={busy} />
        </Card>
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
