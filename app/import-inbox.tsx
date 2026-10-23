import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, Chip, EmptyState, Field, GhostButton, PrimaryButton } from '../components/ui';
import { WalletChips, parseAmountInput } from '../components/finance';
import { getLedger } from '../lib/finance/appLedger';
import { formatMinor } from '../lib/finance/money';
import type { Category, ImportObservation, ImportStatus, Wallet } from '../lib/finance/types';

const TABS: { key: ImportStatus; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'imported', label: 'Imported' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'duplicate', label: 'Duplicates' },
];

const CLASS_OPTIONS = [
  { key: 'expense', label: 'Expense' },
  { key: 'income', label: 'Income' },
  { key: 'fee', label: 'Fee' },
  { key: 'refund_received', label: 'Refund in' },
  { key: 'refund_issued', label: 'Refund out' },
] as const;

export default function ImportInboxScreen() {
  const ledger = getLedger();
  const [tab, setTab] = useState<ImportStatus>('new');
  const [items, setItems] = useState<ImportObservation[]>([]);
  const [counts, setCounts] = useState<Record<ImportStatus, number>>({ new: 0, needs_review: 0, imported: 0, ignored: 0, duplicate: 0 });
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ImportObservation | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editWalletId, setEditWalletId] = useState<string | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editClass, setEditClass] = useState<string>('expense');

  const load = useCallback(async () => {
    const [rows, c, w, cats] = await Promise.all([
      ledger.listObservations({ status: tab, limit: 200 }),
      ledger.countObservationsByStatus(),
      ledger.listWallets(),
      ledger.listCategories(),
    ]);
    setItems(rows);
    setCounts(c);
    setWallets(w);
    setCategories(cats);
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const actionable = tab === 'new' || tab === 'needs_review';

  const confirm = async (obs: ImportObservation) => {
    try {
      const { transaction } = await ledger.confirmObservation(obs.id);
      Alert.alert('Imported', `${formatMinor(transaction.amountMinor)} posted to your ledger.`);
      load();
    } catch (e) {
      Alert.alert('Cannot import', e instanceof Error ? e.message : String(e));
    }
  };

  const confirmTransfer = async (obs: ImportObservation) => {
    try {
      const { transaction } = await ledger.confirmObservationAsTransfer(obs.id);
      Alert.alert('Transfer recorded', `${formatMinor(transaction.amountMinor)} moved between wallets as one transfer — no income or expense counted.`);
      load();
    } catch (e) {
      Alert.alert('Cannot confirm transfer', `${e instanceof Error ? e.message : String(e)} You can still import the two sides separately.`);
    }
  };

  const ignore = async (obs: ImportObservation) => {
    await ledger.ignoreObservation(obs.id);
    load();
  };

  const markDup = async (obs: ImportObservation) => {
    await ledger.markObservationDuplicate(obs.id);
    load();
  };

  const saveEditConfirm = async () => {
    if (!editing) return;
    const parsed = parseAmountInput(editAmount);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    try {
      await ledger.confirmObservation(editing.id, {
        amountMinor: parsed.minor,
        walletId: editWalletId ?? undefined,
        categoryId: editCategoryId,
        classification: editClass as never,
      });
      setEditing(null);
      load();
    } catch (e) {
      Alert.alert('Cannot import', e instanceof Error ? e.message : String(e));
    }
  };

  const bulkConfirm = async () => {
    const ids = [...selected];
    const result = await ledger.bulkConfirmObservations(ids);
    setSelected(new Set());
    setSelectMode(false);
    if (result.failed.length > 0) {
      Alert.alert(
        'Bulk confirm finished',
        `${result.confirmed.length} imported. ${result.failed.length} could not be imported: ${result.failed[0].error}`,
      );
    }
    load();
  };

  const bulkIgnore = async () => {
    await ledger.bulkIgnoreObservations([...selected]);
    setSelected(new Set());
    setSelectMode(false);
    load();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openEditor = (obs: ImportObservation) => {
    setEditing(obs);
    setEditAmount(((obs.amountMinor ?? 0) / 100).toString());
    setEditWalletId(obs.suggestedWalletId);
    setEditCategoryId(obs.suggestedCategoryId);
    setEditClass(obs.suggestedClassification ?? (obs.direction === 'in' ? 'income' : 'expense'));
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 130 }}
        ListHeaderComponent={
          <View>
            <Text style={s.h1}>Import inbox</Text>
            <Text style={s.sub}>Detected bank & wallet transactions. Nothing reaches your ledger until you confirm it.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
              {TABS.map((t) => (
                <Chip
                  key={t.key}
                  label={`${t.label} (${counts[t.key]})`}
                  selected={tab === t.key}
                  onPress={() => {
                    setTab(t.key);
                    setSelected(new Set());
                    setSelectMode(false);
                  }}
                />
              ))}
            </View>
            {actionable && items.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <GhostButton title={selectMode ? 'Done selecting' : 'Select multiple'} onPress={() => { setSelectMode(!selectMode); setSelected(new Set()); }} />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState
              emoji={tab === 'new' || tab === 'needs_review' ? '🎉' : '📭'}
              title={tab === 'new' ? 'No new imports' : tab === 'needs_review' ? 'Nothing needs review' : 'Nothing here'}
              body="When your bank or wallet reports a transaction, it will appear here first."
            />
          </Card>
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          const walletName = wallets.find((w) => w.id === item.suggestedWalletId)?.name;
          const canConfirm = item.parseStatus === 'completed' && (item.status === 'new' || item.status === 'needs_review');
          return (
            <Card style={{ marginBottom: 12 }}>
              <Pressable
                onPress={() => {
                  if (selectMode && actionable) toggleSelect(item.id);
                  else if (item.status === 'imported' && item.transactionId) router.push({ pathname: '/transaction/[id]', params: { id: item.transactionId } });
                }}
              >
                <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={{ fontSize: 15.5, fontWeight: '800', color: C.ink }}>
                      {item.direction === 'in' ? '📥' : '📤'} {item.institution ?? 'Import'}
                      {item.counterparty ? ` · ${item.counterparty}` : ''}
                    </Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
                      {item.localDate} · via {item.source}
                      {item.reference ? ` · Ref ${item.reference}` : ''}
                      {walletName ? ` · → ${walletName}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] }}>
                      {item.amountMinor != null ? formatMinor(item.amountMinor) : '—'}
                    </Text>
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: item.confidencePct >= 80 ? C.emeraldDark : item.confidencePct >= 60 ? C.amberDark : C.inkFaint, marginTop: 3 }}>
                      {item.confidencePct}% confidence
                    </Text>
                  </View>
                </View>
              </Pressable>

              {item.parseStatus !== 'completed' && (
                <View style={{ backgroundColor: item.parseStatus === 'failed' ? C.redSoft : C.amberSoft, borderRadius: 10, padding: 9, marginTop: 10 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: item.parseStatus === 'failed' ? C.redDark : C.amberDark }}>
                    {item.parseStatus === 'failed' ? '⛔ FAILED at the bank — not posted' : '⏳ PENDING at the bank — do not import yet'}
                  </Text>
                </View>
              )}
              {item.reason && item.status !== 'imported' && (
                <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 8 }}>{item.reason}</Text>
              )}
              {item.excerpt && <Text style={{ fontSize: 12, color: C.inkFaint, marginTop: 6 }} numberOfLines={2}>“{item.excerpt}”</Text>}

              {selectMode && actionable && (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ fontWeight: '800', color: isSelected ? C.emeraldDark : C.inkFaint }}>{isSelected ? '✓ Selected' : 'Tap the card to select'}</Text>
                </View>
              )}

              {!selectMode && (item.status === 'new' || item.status === 'needs_review') && (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {canConfirm && <PrimaryButton title="Confirm import" onPress={() => confirm(item)} />}
                  {canConfirm && item.candidateObservationId && (
                    <GhostButton title="Confirm as ONE wallet transfer" onPress={() => confirmTransfer(item)} />
                  )}
                  {canConfirm && <GhostButton title="Edit & confirm" onPress={() => openEditor(item)} />}
                  {item.candidateTransactionId && (
                    <GhostButton
                      title="View the similar ledger entry"
                      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.candidateTransactionId as string } })}
                    />
                  )}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <GhostButton title="Ignore" onPress={() => ignore(item)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <GhostButton title="Mark duplicate" onPress={() => markDup(item)} />
                    </View>
                  </View>
                </View>
              )}
              {item.status === 'imported' && (
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: C.emeraldDark, marginTop: 10 }}>✓ Imported — tap the card to open the entry</Text>
              )}
            </Card>
          );
        }}
      />

      {editing && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.card, borderTopWidth: 1.5, borderTopColor: C.line, padding: 18, paddingBottom: 28 }}>
          <Text style={s.h2}>Edit & confirm</Text>
          <View style={{ height: 10 }} />
          <Field label="Amount (Rs)" value={editAmount} onChangeText={setEditAmount} keyboardType="decimal-pad" />
          <WalletChips wallets={wallets} value={editWalletId} onChange={setEditWalletId} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {CLASS_OPTIONS.map((c) => (
              <Chip key={c.key} label={c.label} selected={editClass === c.key} onPress={() => setEditClass(c.key)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {categories
              .filter((c) => (editClass === 'income' ? c.kind === 'income' || c.kind === 'both' : c.kind === 'expense' || c.kind === 'both'))
              .map((c) => (
                <Chip key={c.id} label={c.name} emoji={c.icon ?? undefined} selected={editCategoryId === c.id} onPress={() => setEditCategoryId(c.id)} />
              ))}
            <Chip label="None" selected={editCategoryId === null} onPress={() => setEditCategoryId(null)} />
          </View>
          <PrimaryButton title="Confirm import" onPress={saveEditConfirm} />
          <View style={{ height: 8 }} />
          <GhostButton title="Cancel" onPress={() => setEditing(null)} />
        </View>
      )}

      {selectMode && selected.size > 0 && !editing && (
        <View style={{ position: 'absolute', left: 14, right: 14, bottom: 18, backgroundColor: C.ink, borderRadius: 20, padding: 16 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{selected.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Confirm all" onPress={bulkConfirm} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Ignore all" onPress={bulkIgnore} />
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
