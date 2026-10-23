import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, DangerButton, Field, GhostButton, HeroCard, PrimaryButton } from '../../components/ui';
import { CLASSIFICATION_LABEL, parseSignedAmountInput, todayInput } from '../../components/finance';
import { getLedger } from '../../lib/finance/appLedger';
import { formatMinor } from '../../lib/finance/money';
import type { Transaction } from '../../lib/finance/types';

interface Detail {
  wallet: { id: string; name: string; kind: string; icon: string | null; color: string | null; archived: boolean; balanceMinor: number };
  transactionCount: number;
  hasOpeningBalance: boolean;
  recent: Transaction[];
}

export default function WalletDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const ledger = getLedger();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [actual, setActual] = useState('');
  const [opening, setOpening] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const d = await ledger.getWalletDetail(id);
    setDetail(d as Detail);
    setName(d.wallet.name);
    setIcon(d.wallet.icon ?? '');
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!detail) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={{ padding: 24 }}>
          <Text style={s.h2}>Wallet not found</Text>
        </View>
      </SafeAreaView>
    );
  }
  const w = detail.wallet;

  const saveEdit = async () => {
    try {
      await ledger.updateWallet(w.id, { name: name.trim(), icon: icon.trim() || null });
      load();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  const doOpening = async () => {
    const parsed = parseSignedAmountInput(opening);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    try {
      await ledger.setOpeningBalance({
        walletId: w.id,
        signedAmountMinor: parsed.minor,
        occurredAt: new Date(`${todayInput()}T12:00:00`).getTime(),
        note: 'Opening balance',
      });
      setOpening('');
      load();
    } catch (e) {
      Alert.alert('Could not set opening balance', e instanceof Error ? e.message : String(e));
    }
  };

  const doReconcile = async () => {
    const parsed = parseSignedAmountInput(actual);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    try {
      const result = await ledger.reconcileWallet(w.id, parsed.minor, { note: 'Reconciliation' });
      if (!result.adjusted) Alert.alert('Already matches', 'The recorded balance already equals the actual balance.');
      else Alert.alert('Reconciled', `Adjustment of ${formatMinor(result.deltaMinor)} posted. Balance is now ${formatMinor(parsed.minor)}.`);
      setActual('');
      load();
    } catch (e) {
      Alert.alert('Could not reconcile', e instanceof Error ? e.message : String(e));
    }
  };

  const doArchive = async () => {
    try {
      await ledger.setWalletArchived(w.id, !w.archived);
      load();
    } catch (e) {
      Alert.alert('Could not update wallet', e instanceof Error ? e.message : String(e));
    }
  };

  const doDelete = () => {
    Alert.alert('Delete wallet?', 'Only unused wallets can be deleted. Wallets with transactions must be archived instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await ledger.deleteWallet(w.id);
            router.back();
          } catch (e) {
            Alert.alert('Cannot delete', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: w.name }} />
      <ScrollView contentContainerStyle={s.scroll}>
        <HeroCard
          eyebrow={`${w.name} balance`}
          value={formatMinor(w.balanceMinor)}
          valueColor={w.balanceMinor < 0 ? '#FDA4AF' : '#fff'}
          sub={`${detail.transactionCount} ledger entries${detail.hasOpeningBalance ? ' · opening balance set' : ' · no opening balance yet'}${w.archived ? ' · archived' : ''}`}
        />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton title="Transfer out" onPress={() => router.push({ pathname: '/transfer', params: { from: w.id } })} />
          </View>
          <View style={{ flex: 1 }}>
            <GhostButton title="All transactions" onPress={() => router.push('/transactions')} />
          </View>
        </View>

        {!detail.hasOpeningBalance && detail.transactionCount === 0 && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.h2}>Set opening balance</Text>
            <Text style={s.sub}>How much is actually in this wallet right now? This becomes its starting balance — nothing is invented.</Text>
            <View style={{ height: 10 }} />
            <Field label="Current balance (Rs)" value={opening} onChangeText={setOpening} keyboardType="decimal-pad" placeholder="e.g. 5000" />
            <PrimaryButton title="Set opening balance" onPress={doOpening} />
          </Card>
        )}

        <Card style={{ marginTop: 14 }}>
          <Text style={s.h2}>Reconcile</Text>
          <Text style={s.sub}>Recorded: {formatMinor(w.balanceMinor)}. Enter the real balance and the difference is posted as an adjustment — the recorded history is never overwritten.</Text>
          <View style={{ height: 10 }} />
          <Field label="Actual balance (Rs)" value={actual} onChangeText={setActual} keyboardType="decimal-pad" placeholder="e.g. 4850" />
          <PrimaryButton title="Reconcile wallet" onPress={doReconcile} />
        </Card>

        <Card style={{ marginTop: 14 }}>
          <Text style={s.h2}>Edit wallet</Text>
          <View style={{ height: 12 }} />
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Icon (emoji)" value={icon} onChangeText={setIcon} placeholder="👛" />
          <PrimaryButton title="Save" onPress={saveEdit} />
        </Card>

        <Text style={s.sectionTitle}>Recent activity</Text>
        {detail.recent.length === 0 ? (
          <Card>
            <Text style={{ color: C.inkSoft }}>No transactions touch this wallet yet.</Text>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 6 }}>
            {detail.recent.map((t, i) => (
              <Pressable key={t.id} onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}>
                <View style={[s.row, { paddingVertical: 11, borderBottomWidth: i === detail.recent.length - 1 ? 0 : 1, borderBottomColor: C.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '800', color: C.ink }}>{t.counterparty ?? CLASSIFICATION_LABEL[t.classification]}</Text>
                    <Text style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>{CLASSIFICATION_LABEL[t.classification]} · {t.localDate}</Text>
                  </View>
                  <Text style={{ fontSize: 14.5, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] }}>{formatMinor(t.amountMinor)}</Text>
                </View>
              </Pressable>
            ))}
          </Card>
        )}

        <View style={{ marginTop: 18, gap: 10 }}>
          <GhostButton title={w.archived ? 'Restore wallet' : 'Archive wallet'} onPress={doArchive} />
          <DangerButton title="Delete wallet" onPress={doDelete} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
