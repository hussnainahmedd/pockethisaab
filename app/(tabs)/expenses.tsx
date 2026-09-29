import { useCallback, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, Chip, EmptyState, HeroCard } from '../../components/ui';
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

  const rowActions = (e: Expense, label: string) => {
    Alert.alert(`Spent · ${formatRs(e.amount)}`, 'What do you want to do?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: '✏️ Edit',
        onPress: () => router.push({ pathname: '/edit-expense', params: { id: String(e.id) } }),
      },
      {
        text: '🗑️ Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete expense?', `"${label}" will be removed permanently.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                await deleteExpense(e.id);
                load();
              },
            },
          ]),
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
            <Text style={s.eyebrow}>track it ✦</Text>
            <Text style={[s.h1, { marginTop: 4 }]}>Expenses</Text>
          </View>
          <Pressable
            onPress={() => router.push('/add-expense')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
          >
            <LinearGradient
              colors={['#F43F5E', '#E11D48']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 999,
                paddingHorizontal: 18,
                paddingVertical: 13,
                shadowColor: '#F43F5E',
                shadowOpacity: 0.4,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 5 },
                elevation: 5,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>+ Add</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Month navigator */}
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 18 }]}>
          <Pressable onPress={() => setMonthOffset((o) => o - 1)} style={styles.navBtn}>
            <Text style={styles.navText}>‹ Prev</Text>
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: '900', color: C.ink, letterSpacing: -0.3 }}>{monthTitle(prefix)}</Text>
          <Pressable
            onPress={() => monthOffset < 0 && setMonthOffset((o) => o + 1)}
            style={[styles.navBtn, monthOffset >= 0 && { opacity: 0.35 }]}
          >
            <Text style={styles.navText}>Next ›</Text>
          </Pressable>
        </View>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16, marginHorizontal: -18, paddingHorizontal: 18 }}>
          <Chip label="All" selected={category === null} onPress={() => setCategory(null)} />
          {CATEGORIES.map((c) => (
            <Chip key={c.key} label={c.label} emoji={c.emoji} selected={category === c.key} onPress={() => setCategory(category === c.key ? null : c.key)} />
          ))}
        </ScrollView>

        <HeroCard
          colors={['#F43F5E', '#E11D48', '#7F1D1D'] as unknown as readonly [string, string, ...string[]]}
          eyebrow={`total spent${category ? ` · ${CATEGORIES.find((c) => c.key === category)?.label.toUpperCase()}` : ''}`}
          value={formatRs(total)}
          sub={`${expenses.length} ${expenses.length === 1 ? 'entry' : 'entries'} in ${monthTitle(prefix)}`}
        />

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
              const label = e.note || cat?.label || 'Expense';
              return (
                <Pressable
                  key={e.id}
                  onLongPress={() => rowActions(e, label)}
                  delayLongPress={350}
                  style={[
                    s.row,
                    { paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: i === expenses.length - 1 ? 0 : 1, borderBottomColor: C.line },
                  ]}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 16,
                      backgroundColor: C.redSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 13,
                    }}
                  >
                    <Text style={{ fontSize: 21 }}>{cat?.emoji ?? '📦'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: -0.2 }}>{label}</Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
                      {cat?.label} · {prettyDate(e.date)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 15.5, fontWeight: '900', color: C.redDark, fontVariant: ['tabular-nums'], letterSpacing: -0.3 }}>
                    −{formatRs(e.amount)}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        )}
        {expenses.length > 0 && (
          <Text style={{ textAlign: 'center', color: C.inkFaint, fontSize: 12, marginTop: 14 }}>
            Long-press an entry to edit or delete it.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  navBtn: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#DCE9E1',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  } as const,
  navText: { fontSize: 13.5, fontWeight: '800', color: '#0A1F16' } as const,
};
