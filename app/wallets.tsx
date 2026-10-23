import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, Chip, EmptyState, Field, GhostButton, HeroCard, PrimaryButton } from '../components/ui';
import { getLedger } from '../lib/finance/appLedger';
import { formatMinor } from '../lib/finance/money';
import type { Wallet, WalletKind } from '../lib/finance/types';

const KINDS: { key: WalletKind; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'mobile', label: 'Mobile wallet' },
  { key: 'bank', label: 'Bank' },
  { key: 'custom', label: 'Custom' },
];

export default function WalletsScreen() {
  const ledger = getLedger();
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WalletKind>('custom');

  const load = useCallback(async () => {
    setWallets(await ledger.listWallets({ includeArchived: true }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const active = wallets.filter((w) => !w.archived);
  const archived = wallets.filter((w) => w.archived);
  const total = active.reduce((a, w) => a + w.balanceMinor, 0);

  const create = async () => {
    if (!name.trim()) return Alert.alert('Name needed', 'Give the wallet a name.');
    try {
      await ledger.createWallet(name.trim(), kind);
      setName('');
      setShowForm(false);
      load();
    } catch (e) {
      Alert.alert('Could not create wallet', e instanceof Error ? e.message : String(e));
    }
  };

  const renderWallet = (w: Wallet & { balanceMinor: number }) => (
    <Card key={w.id} style={{ marginBottom: 12, opacity: w.archived ? 0.6 : 1 }}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16.5, fontWeight: '800', color: C.ink }}>
            {w.icon ?? '👛'} {w.name}
          </Text>
          <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
            {KINDS.find((k) => k.key === w.kind)?.label ?? w.kind}
            {w.archived ? ' · archived' : ''}
          </Text>
        </View>
        <Text style={{ fontSize: 17, fontWeight: '900', color: w.balanceMinor < 0 ? C.redDark : C.ink, fontVariant: ['tabular-nums'] }}>
          {formatMinor(w.balanceMinor)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <GhostButton title="Details" onPress={() => router.push({ pathname: '/wallet/[id]', params: { id: w.id } })} />
        </View>
        <View style={{ flex: 1 }}>
          <GhostButton title="Transfer" onPress={() => router.push({ pathname: '/transfer', params: { from: w.id } })} />
        </View>
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>Wallets</Text>
        <HeroCard eyebrow="available cash" value={formatMinor(total)} sub="Sum of all active wallet balances, straight from the ledger." />
        <View style={{ height: 16 }} />
        {active.map(renderWallet)}
        {active.length === 0 && (
          <Card>
            <EmptyState emoji="👛" title="No active wallets" body="Create a wallet to start tracking where your money lives." />
          </Card>
        )}

        {showForm ? (
          <Card style={{ marginTop: 6 }}>
            <Text style={s.h2}>New wallet</Text>
            <View style={{ height: 12 }} />
            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. HBL, Meezan, Drawer cash" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
              {KINDS.map((k) => (
                <Chip key={k.key} label={k.label} selected={kind === k.key} onPress={() => setKind(k.key)} />
              ))}
            </View>
            <PrimaryButton title="Create wallet (starts at Rs 0)" onPress={create} />
            <View style={{ height: 10 }} />
            <GhostButton title="Cancel" onPress={() => setShowForm(false)} />
          </Card>
        ) : (
          <PrimaryButton title="+ New wallet" onPress={() => setShowForm(true)} />
        )}

        {archived.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Archived</Text>
            {showArchived ? archived.map(renderWallet) : <GhostButton title={`Show ${archived.length} archived`} onPress={() => setShowArchived(true)} />}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
