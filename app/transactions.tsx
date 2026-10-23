import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, Chip, EmptyState, GhostButton, PrimaryButton } from '../components/ui';
import { CLASSIFICATION_LABEL } from '../components/finance';
import { getLedger } from '../lib/finance/appLedger';
import { formatMinor } from '../lib/finance/money';
import type { Classification, Transaction } from '../lib/finance/types';

const FILTERS: { key: string; label: string; classes?: Classification[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'income', label: 'Income', classes: ['income'] },
  { key: 'expenses', label: 'Expenses', classes: ['expense', 'fee'] },
  { key: 'transfers', label: 'Transfers', classes: ['transfer'] },
  { key: 'udhaar', label: 'Udhaar', classes: ['loan_lent', 'loan_borrowed', 'repayment_received', 'repayment_made'] },
  { key: 'other', label: 'Refunds & more', classes: ['refund_received', 'refund_issued', 'balance_adjustment', 'opening_balance'] },
];

const SORTS = [
  { key: 'date_desc', label: 'Newest first' },
  { key: 'date_asc', label: 'Oldest first' },
  { key: 'amount_desc', label: 'Amount: high → low' },
  { key: 'amount_asc', label: 'Amount: low → high' },
] as const;

const PAGE = 50;

export default function TransactionsScreen() {
  const ledger = getLedger();
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filterKey, setFilterKey] = useState('all');
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('date_desc');
  const [limit, setLimit] = useState(PAGE);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryPanel, setCategoryPanel] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [lastDeleted, setLastDeleted] = useState<string[] | null>(null);

  const activeFilter = useMemo(() => FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0], [filterKey]);

  const load = useCallback(async () => {
    const query = {
      classifications: activeFilter.classes,
      search: search.trim() || undefined,
      sort,
      limit,
    };
    const [rows, count, cats] = await Promise.all([
      ledger.listTransactions(query),
      ledger.countTransactions({ classifications: activeFilter.classes, search: search.trim() || undefined }),
      ledger.listCategories(),
    ]);
    setItems(rows);
    setTotal(count);
    setCategories(cats);
  }, [activeFilter, search, sort, limit]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = items.filter((t) => selected.has(t.id));
  const selectedTotal = selectedItems.reduce((a, t) => a + t.amountMinor, 0);

  const doBulkDelete = async () => {
    const ids = [...selected];
    const summary = await ledger.summarizeTransactions(ids);
    Alert.alert(
      `Delete ${summary.count} entries?`,
      `Total ${formatMinor(summary.totalMinor)}. Deleting reverses these entries and updates every affected balance. You can undo right after. Loans in the selection are protected and will abort the batch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await ledger.bulkReverseTransactions(ids);
              setLastDeleted(ids);
              setSelected(new Set());
              setSelectMode(false);
              load();
            } catch (e) {
              Alert.alert('Nothing was deleted', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  const doUndoDelete = async () => {
    if (!lastDeleted) return;
    try {
      for (const id of lastDeleted) {
        await ledger.restoreTransaction(id);
      }
      setLastDeleted(null);
      load();
    } catch (e) {
      Alert.alert('Undo failed', e instanceof Error ? e.message : String(e));
    }
  };

  const doBulkCategorize = async (categoryId: string) => {
    try {
      await ledger.bulkSetCategory([...selected], categoryId);
      setCategoryPanel(false);
      setSelected(new Set());
      setSelectMode(false);
      load();
    } catch (e) {
      Alert.alert('Nothing was changed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 130 }}
        ListHeaderComponent={
          <View>
            <Text style={s.h1}>Transactions</Text>
            <Text style={s.sub}>{total} entries · every value from the ledger</Text>
            <Pressable onPress={() => router.push('/import-inbox')} style={{ marginTop: 8 }}>
              <Text style={{ color: C.emeraldDark, fontWeight: '800', fontSize: 13.5 }}>📥 Import inbox — review detected transactions →</Text>
            </Pressable>
            <TextInput
              value={search}
              onChangeText={(t) => {
                setSearch(t);
                setLimit(PAGE);
              }}
              placeholder="Search note, person, reference, category…"
              placeholderTextColor={C.inkFaint}
              style={{
                backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.line, borderRadius: 16,
                paddingHorizontal: 16, paddingVertical: 13, fontSize: 15.5, color: C.ink, marginTop: 14,
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
              {FILTERS.map((f) => (
                <Chip
                  key={f.key}
                  label={f.label}
                  selected={filterKey === f.key}
                  onPress={() => {
                    setFilterKey(f.key);
                    setLimit(PAGE);
                    setSelected(new Set());
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
              <View style={{ flex: 1 }}>
                <GhostButton
                  title={`Sort: ${SORTS.find((x) => x.key === sort)?.label}`}
                  onPress={() => {
                    const idx = SORTS.findIndex((x) => x.key === sort);
                    setSort(SORTS[(idx + 1) % SORTS.length].key);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <GhostButton
                  title={selectMode ? 'Done selecting' : 'Select'}
                  onPress={() => {
                    setSelectMode(!selectMode);
                    setSelected(new Set());
                  }}
                />
              </View>
            </View>
            {selectMode && (
              <Pressable onPress={() => setSelected(new Set(items.map((t) => t.id)))}>
                <Text style={{ color: C.emeraldDark, fontWeight: '800', fontSize: 13.5, marginBottom: 8 }}>
                  Select all visible ({items.length})
                </Text>
              </Pressable>
            )}
            {lastDeleted && (
              <Card style={{ marginBottom: 12, backgroundColor: C.amberSoft, borderColor: C.amber }}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={{ fontWeight: '800', color: C.amberDark }}>Deleted {lastDeleted.length} entries</Text>
                  <Pressable onPress={doUndoDelete}>
                    <Text style={{ fontWeight: '900', color: C.emeraldDark }}>Undo</Text>
                  </Pressable>
                </View>
              </Card>
            )}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState emoji="🔍" title="No transactions found" body="Try a different search or filter — or add your first entry." />
          </Card>
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          return (
            <Pressable
              onPress={() => (selectMode ? toggleSelect(item.id) : router.push({ pathname: '/transaction/[id]', params: { id: item.id } }))}
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <View style={[s.row, { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line }]}>
                {selectMode && (
                  <View
                    style={{
                      width: 26, height: 26, borderRadius: 9, marginRight: 12,
                      borderWidth: 2, borderColor: isSelected ? C.emerald : C.line,
                      backgroundColor: isSelected ? C.emerald : 'transparent',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {isSelected && <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>✓</Text>}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>
                    {item.counterparty ?? CLASSIFICATION_LABEL[item.classification]}
                  </Text>
                  <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>
                    {CLASSIFICATION_LABEL[item.classification]} · {item.localDate}
                    {item.note ? ` · ${item.note}` : ''}
                    {item.origin === 'auto' ? ' · ⚡ auto' : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] }}>
                  {formatMinor(item.amountMinor)}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          items.length < total ? (
            <View style={{ marginTop: 16 }}>
              <GhostButton title={`Load more (${items.length} of ${total})`} onPress={() => setLimit(limit + PAGE)} />
            </View>
          ) : null
        }
      />

      {selectMode && selected.size > 0 && (
        <View
          style={{
            position: 'absolute', left: 14, right: 14, bottom: 18, backgroundColor: C.ink, borderRadius: 20,
            padding: 16, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
            {selected.size} selected · {formatMinor(selectedTotal)}
          </Text>
          {categoryPanel ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
              {categories
                .filter((c) => c.kind !== 'both')
                .map((c) => (
                  <Chip key={c.id} label={c.name} selected={false} onPress={() => doBulkCategorize(c.id)} />
                ))}
              <Chip label="✕ Close" selected onPress={() => setCategoryPanel(false)} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Categorize" onPress={() => setCategoryPanel(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Delete" onPress={doBulkDelete} />
              </View>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
