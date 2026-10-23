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

type Purpose = 'income' | 'borrow' | 'repayment' | 'transfer' | 'refund';

const PURPOSES: { key: Purpose; label: string }[] = [
  { key: 'income', label: '💰 Income' },
  { key: 'repayment', label: '↩️ Udhaar repayment received' },
  { key: 'borrow', label: '🤝 Udhaar borrowed' },
  { key: 'transfer', label: '🔁 Wallet transfer' },
  { key: 'refund', label: '🧾 Refund received' },
];

export default function ReceiveScreen() {
  const ledger = getLedger();
  const [purpose, setPurpose] = useState<Purpose>('income');
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lentLoans, setLentLoans] = useState<(Loan & { remainingMinor: number })[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [fromWalletId, setFromWalletId] = useState<string | null>(null);
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
    const pocket = cats.find((c) => c.name === 'Pocket Money' && c.kind === 'income');
    setCategoryId((prev) => prev ?? pocket?.id ?? null);
    const open = loans.filter((l) => l.direction === 'lent' && l.status !== 'void' && l.status !== 'settled');
    const detailed: (Loan & { remainingMinor: number })[] = [];
    for (const l of open) detailed.push({ ...l, remainingMinor: await ledger.getLoanRemainingMinor(l.id) });
    setLentLoans(detailed.filter((l) => l.remainingMinor > 0));
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
    if (!walletId) return Alert.alert('Pick a wallet', 'Choose the wallet the money arrives in.');
    const base = {
      occurredAt: msOfDateInput(date),
      note: note.trim() || null,
      reference: reference.trim() || null,
    };
    setBusy(true);
    try {
      if (purpose === 'income') {
        await ledger.addIncome({ walletId, amountMinor: parsed.minor, categoryId, counterparty: person.trim() || null, ...base });
      } else if (purpose === 'refund') {
        await ledger.addRefundReceived({ walletId, amountMinor: parsed.minor, counterparty: person.trim() || null, ...base });
      } else if (purpose === 'borrow') {
        if (!person.trim()) throw new Error('Enter the person you borrowed from.');
        await ledger.borrow({ personName: person.trim(), phone: phone.trim() || null, walletId, amountMinor: parsed.minor, dueDate: dueDate || null, ...base });
      } else if (purpose === 'repayment') {
        if (!loanId) throw new Error('Pick the udhaar being repaid to you.');
        await ledger.recordRepayment({ loanId, walletId, amountMinor: parsed.minor, ...base });
      } else if (purpose === 'transfer') {
        if (!fromWalletId) throw new Error('Pick the source wallet.');
        await ledger.transfer({ fromWalletId, toWalletId: walletId, amountMinor: parsed.minor, ...base });
      }
      Alert.alert('Recorded', `${formatMinor(parsed.minor)} received · ${PURPOSES.find((p) => p.key === purpose)?.label}. PocketHisaab records movements — it does not move real money.`);
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
        <Text style={s.h1}>Receive money</Text>
        <Text style={s.sub}>Record money arriving in a wallet — and what it really is. A repayment or a loan is not income.</Text>
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
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Source wallet</Text>
              <WalletChips wallets={wallets} value={fromWalletId} onChange={setFromWalletId} excludeId={walletId ?? undefined} />
            </>
          )}
          {purpose === 'income' && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Source / category</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {categories.filter((c) => c.kind === 'income' || c.kind === 'both').map((c) => (
                  <Chip key={c.id} label={c.name} emoji={c.icon ?? undefined} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
                ))}
                <Chip label="None" selected={categoryId === null} onPress={() => setCategoryId(null)} />
              </View>
            </View>
          )}
          {purpose === 'repayment' && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Which udhaar is being repaid?</Text>
              {lentLoans.length === 0 ? (
                <Text style={{ color: C.inkSoft, fontSize: 13.5 }}>Nobody owes you money right now.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {lentLoans.map((l) => (
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
          {(purpose === 'income' || purpose === 'refund') && (
            <Field label="Sender / counterparty" value={person} onChangeText={setPerson} placeholder="Who sent it? (optional)" />
          )}
          {purpose === 'borrow' && (
            <>
              <Field label="Person" value={person} onChangeText={setPerson} placeholder="Who did you borrow from?" autoCapitalize="words" />
              <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="03xx xxxxxxx" keyboardType="numeric" />
              <Field label="Due date (optional, YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder="2026-11-15" />
            </>
          )}
          <Field label="Amount (Rs)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="e.g. 5000" />
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          <Field label="Reference (optional)" value={reference} onChangeText={setReference} placeholder="Bank / wallet reference" />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
          <PrimaryButton title={busy ? 'Recording…' : 'Record receive'} onPress={submit} disabled={busy} />
        </Card>
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
