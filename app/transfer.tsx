import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { s } from '../components/theme';
import { Card, Field, PrimaryButton } from '../components/ui';
import { WalletChips, isValidDateInput, msOfDateInput, parseAmountInput, todayInput } from '../components/finance';
import { getLedger } from '../lib/finance/appLedger';
import { formatMinor } from '../lib/finance/money';
import type { Wallet } from '../lib/finance/types';

export default function TransferScreen() {
  const params = useLocalSearchParams<{ from?: string }>();
  const ledger = getLedger();
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await ledger.listWallets();
    setWallets(list);
    const fromParam = Array.isArray(params.from) ? params.from[0] : params.from;
    setFromId((prev) => prev ?? fromParam ?? list[0]?.id ?? null);
    setToId((prev) => prev ?? list.find((w) => w.id !== (fromParam ?? list[0]?.id))?.id ?? null);
  }, [params.from]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const submit = async () => {
    if (!fromId || !toId) return Alert.alert('Pick wallets', 'Choose a source and a destination wallet.');
    if (fromId === toId) return Alert.alert('Same wallet', 'A transfer needs two different wallets.');
    const parsed = parseAmountInput(amount);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    if (!isValidDateInput(date)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD with a real calendar date.');
    setBusy(true);
    try {
      await ledger.transfer({
        fromWalletId: fromId,
        toWalletId: toId,
        amountMinor: parsed.minor,
        occurredAt: msOfDateInput(date),
        note: note.trim() || null,
      });
      Alert.alert('Transfer recorded', `${formatMinor(parsed.minor)} moved. Total cash and monthly income/expenses are unchanged.`);
      router.back();
    } catch (e) {
      Alert.alert('Could not transfer', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>Transfer</Text>
        <Text style={s.sub}>Move money between your wallets. Transfers are never income or expenses.</Text>
        <Card style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 7 }}>From</Text>
          <WalletChips wallets={wallets} value={fromId} onChange={(id) => { setFromId(id); if (toId === id) setToId(null); }} />
          <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 7 }}>To</Text>
          <WalletChips wallets={wallets} value={toId} onChange={setToId} excludeId={fromId ?? undefined} />
          <Field label="Amount (Rs)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="e.g. 2000" />
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
          <PrimaryButton title={busy ? 'Recording…' : 'Record transfer'} onPress={submit} disabled={busy} />
        </Card>
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
