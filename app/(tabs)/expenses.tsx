import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, Chip, EmptyState } from '../../components/ui';
import { CATEGORIES, deleteExpense, getExpenses, type Expense } from '../../lib/db';
import { formatRs, monthPrefixOf, monthTitle, prettyDate } from '../../lib/format';

export default function Expenses() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const prefix = monthPrefixOf(monthOffset);

  const load = useCallback(async () => {
    setExpenses(await getExpenses(prefix, category));
  }, [prefix, category]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const total = expenses.reduce((a, e) => a + e.amount, 0);

  const confirmDelete = (id: number, label: string) => {
    Alert.alert('Delete expense?', `"${label}" will be removed permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(id);
          load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>Expenses</Text>
            <Text style={s.sub}>Every rupee, accounted for.</Text>
          </View>
          <Pressable
            onPress={() => router.push('/add-expense')}
            style={({ pressed }) => ({
              backgroundColor: C.emerald,
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 11,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>+ Add</Text>
          </Pressable>
        </View>

        {/* Month navigator */}
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 16 }]}>
          <Pressable onPress={() => setMonthOffset((o) => o - 1)} style={styles.navBtn}>
            <Text style={styles.navText}>‹ Prev</Text>
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink }}>{monthTitle(prefix)}</Text>
          <Pressable
            onPress={() => monthOffset < 0 && setMonthOffset((o) => o + 1)}
            style={[styles.navBtn, monthOffset >= 0 && { opacity: 0.35 }]}
          >
            <Text style={styles.navText}>Next ›</Text>
          </Pressable>
        </View>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, marginHorizontal: -18, paddingHorizontal: 18 }}>
          <Chip label="All" selected={category === null} onPress={() => setCategory(null)} />
          {CATEGORIES.map((c) => (
            <Chip key={c.key} label={c.label} emoji={c.emoji} selected={category === c.key} onPress={() => setCategory(category === c.key ? null : c.key)} />
          ))}
        </ScrollView>

        <Card style={{ marginTop: 14, backgroundColor: C.navy, borderColor: C.navy }}>
          <Text style={{ color: '#9FC4B8', fontSize: 12.5, fontWeight: '600' }}>
            TOTAL SPENT{category ? ` · ${CATEGORIES.find((c) => c.key === category)?.label.toUpperCase()}` : ''}
          </Text>
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] }}>
            {formatRs(total)}
          </Text>
          <Text style={{ color: '#9FC4B8', fontSize: 12.5, marginTop: 6 }}>
            {expenses.length} {expenses.length === 1 ? 'entry' : 'entries'} in {monthTitle(prefix)}
          </Text>
        </Card>

        <Text style={s.sectionTitle}>Entries</Text>
        {expenses.length === 0 ? (
          <Card>
            <EmptyState
              emoji="🧾"
              title="No expenses yet"
              body={
                category
                  ? `Nothing in ${CATEGORIES.find((c) => c.key === category)?.label} for ${monthTitle(prefix)}.`
                  : `No spending recorded for ${monthTitle(prefix)}. Tap + Add to log your first expense.`
              }
            />
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {expenses.map((e, i) => {
              const cat = CATEGORIES.find((c) => c.key === e.category);
              return (
                <Pressable
                  key={e.id}
                  onLongPress={() => confirmDelete(e.id, e.note || cat?.label || 'Expense')}
                  style={[
                    s.row,
                    { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: i === expenses.length - 1 ? 0 : 1, borderBottomColor: C.line },
                  ]}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 13,
                      backgroundColor: C.redSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{cat?.emoji ?? '📦'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }}>
                      {e.note || cat?.label || 'Expense'}
                    </Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>
                      {cat?.label} · {prettyDate(e.date)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.red, fontVariant: ['tabular-nums'] }}>
                    −{formatRs(e.amount)}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        )}
        {expenses.length > 0 && (
          <Text style={{ textAlign: 'center', color: C.inkFaint, fontSize: 12, marginTop: 12 }}>
            Long-press an entry to delete it.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  navBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E4ECEA',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  } as const,
  navText: { fontSize: 13.5, fontWeight: '700', color: '#0F1E1B' } as const,
};
