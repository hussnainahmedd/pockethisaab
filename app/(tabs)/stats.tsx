import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, EmptyState } from '../../components/ui';
import { categoryEmoji, categoryLabel, getMonthlyStats, getTopCategories } from '../../lib/db';
import { formatRs, monthPrefixOf, monthTitle, shortMonthTitle } from '../../lib/format';

export default function Stats() {
  const [prefix] = useState(() => monthPrefixOf(0));
  const [monthly, setMonthly] = useState<{ month: string; income: number; expenses: number }[]>([]);
  const [top, setTop] = useState<{ category: string; total: number }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [m, t] = await Promise.all([getMonthlyStats(6), getTopCategories(prefix, 5)]);
    setMonthly(m);
    setTop(t);
  }, [prefix]);

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

  const current = monthly[monthly.length - 1];
  const monthIncome = current?.income ?? 0;
  const monthExpenses = current?.expenses ?? 0;
  const maxBar = Math.max(1, ...monthly.map((m) => Math.max(m.income, m.expenses)));
  const maxCat = Math.max(1, ...top.map((t) => t.total));
  const isFresh = monthly.every((m) => m.income === 0 && m.expenses === 0);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <Text style={s.h1}>Stats</Text>
        <Text style={s.sub}>Your money at a glance.</Text>

        {isFresh ? (
          <Card style={{ marginTop: 18 }}>
            <EmptyState
              emoji="📊"
              title="No stats yet"
              body="Once you add pocket money and expenses, your monthly summaries and top spending categories will show up here."
            />
          </Card>
        ) : (
          <>
            <Text style={s.sectionTitle}>{monthTitle(prefix)}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, backgroundColor: C.emeraldSoft, borderRadius: 14, padding: 14 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: C.inkSoft }}>Money in</Text>
                <Text style={{ fontSize: 17, fontWeight: '800', color: C.emeraldDark, marginTop: 6, fontVariant: ['tabular-nums'] }}>
                  {formatRs(monthIncome)}
                </Text>
              </View>
              <View style={{ flex: 1, backgroundColor: C.redSoft, borderRadius: 14, padding: 14 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: C.inkSoft }}>Money out</Text>
                <Text style={{ fontSize: 17, fontWeight: '800', color: C.red, marginTop: 6, fontVariant: ['tabular-nums'] }}>
                  {formatRs(monthExpenses)}
                </Text>
              </View>
            </View>
            <Card style={{ marginTop: 10, backgroundColor: C.navy, borderColor: C.navy }}>
              <Text style={{ color: '#9FC4B8', fontSize: 12.5, fontWeight: '600' }}>NET THIS MONTH</Text>
              <Text
                style={{
                  color: monthIncome - monthExpenses >= 0 ? '#7FE3B0' : '#FF9B9E',
                  fontSize: 26,
                  fontWeight: '800',
                  marginTop: 6,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {monthIncome - monthExpenses >= 0 ? '+' : '−'}
                {formatRs(Math.abs(monthIncome - monthExpenses))}
              </Text>
            </Card>

            <Text style={s.sectionTitle}>Last 6 months</Text>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 150 }}>
                {monthly.map((m) => (
                  <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 118 }}>
                      <View
                        style={{
                          width: 10,
                          height: Math.max(4, (m.income / maxBar) * 118),
                          borderRadius: 5,
                          backgroundColor: C.emerald,
                        }}
                      />
                      <View
                        style={{
                          width: 10,
                          height: Math.max(4, (m.expenses / maxBar) * 118),
                          borderRadius: 5,
                          backgroundColor: C.red,
                        }}
                      />
                    </View>
                    <Text style={{ fontSize: 10.5, color: C.inkFaint, marginTop: 6, fontWeight: '600' }}>
                      {shortMonthTitle(m.month)}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={[s.row, { marginTop: 12, gap: 16, justifyContent: 'center' }]}>
                <View style={s.row}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.emerald, marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: C.inkSoft, fontWeight: '600' }}>Money in</Text>
                </View>
                <View style={s.row}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red, marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: C.inkSoft, fontWeight: '600' }}>Money out</Text>
                </View>
              </View>
            </Card>

            <Text style={s.sectionTitle}>Top spending · {monthTitle(prefix)}</Text>
            <Card style={{ paddingVertical: 6 }}>
              {top.length === 0 ? (
                <Text style={{ padding: 16, color: C.inkSoft, textAlign: 'center' }}>No spending this month.</Text>
              ) : (
                top.map((t, i) => (
                  <View
                    key={t.category}
                    style={{ paddingVertical: 11, borderBottomWidth: i === top.length - 1 ? 0 : 1, borderBottomColor: C.line }}
                  >
                    <View style={[s.row, { justifyContent: 'space-between', marginBottom: 7 }]}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>
                        {categoryEmoji(t.category)} {categoryLabel(t.category)}
                      </Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] }}>
                        {formatRs(t.total)}
                      </Text>
                    </View>
                    <View style={{ height: 7, borderRadius: 4, backgroundColor: C.bg, overflow: 'hidden' }}>
                      <View style={{ height: 7, borderRadius: 4, width: `${(t.total / maxCat) * 100}%`, backgroundColor: C.emerald }} />
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
