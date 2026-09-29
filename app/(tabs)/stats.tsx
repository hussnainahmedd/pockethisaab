import { useCallback, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, EmptyState, HeroCard } from '../../components/ui';
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
  const netMonth = monthIncome - monthExpenses;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <Text style={s.eyebrow}>receipts ✦</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>Stats</Text>
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
              <View style={{ flex: 1, backgroundColor: C.emeraldSoft, borderRadius: 20, padding: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1, color: C.emeraldDark, textTransform: 'uppercase' }}>
                  Money in
                </Text>
                <Text style={{ fontSize: 19, fontWeight: '900', color: C.emeraldDark, marginTop: 8, fontVariant: ['tabular-nums'], letterSpacing: -0.4 }}>
                  {formatRs(monthIncome)}
                </Text>
              </View>
              <View style={{ flex: 1, backgroundColor: C.redSoft, borderRadius: 20, padding: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1, color: C.redDark, textTransform: 'uppercase' }}>
                  Money out
                </Text>
                <Text style={{ fontSize: 19, fontWeight: '900', color: C.redDark, marginTop: 8, fontVariant: ['tabular-nums'], letterSpacing: -0.4 }}>
                  {formatRs(monthExpenses)}
                </Text>
              </View>
            </View>
            <HeroCard
              eyebrow="net this month"
              value={`${netMonth >= 0 ? '+' : '−'}${formatRs(Math.abs(netMonth))}`}
              valueColor={netMonth >= 0 ? '#BEF264' : '#FDA4AF'}
            />

            <Text style={s.sectionTitle}>Last 6 months</Text>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 160 }}>
                {monthly.map((m) => (
                  <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 126 }}>
                      <LinearGradient
                        colors={['#0E9F6E', '#14B8A6']}
                        style={{ width: 11, height: Math.max(5, (m.income / maxBar) * 126), borderRadius: 6 }}
                      />
                      <LinearGradient
                        colors={['#F43F5E', '#E11D48']}
                        style={{ width: 11, height: Math.max(5, (m.expenses / maxBar) * 126), borderRadius: 6 }}
                      />
                    </View>
                    <Text style={{ fontSize: 10.5, color: C.inkFaint, marginTop: 8, fontWeight: '700' }}>
                      {shortMonthTitle(m.month)}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={[s.row, { marginTop: 14, gap: 18, justifyContent: 'center' }]}>
                <View style={s.row}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.emerald, marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: C.inkSoft, fontWeight: '700' }}>Money in</Text>
                </View>
                <View style={s.row}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red, marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: C.inkSoft, fontWeight: '700' }}>Money out</Text>
                </View>
              </View>
            </Card>

            <Text style={s.sectionTitle}>Top spending · {monthTitle(prefix)}</Text>
            <Card style={{ paddingVertical: 6 }}>
              {top.length === 0 ? (
                <Text style={{ padding: 18, color: C.inkSoft, textAlign: 'center' }}>No spending this month. Suspiciously responsible. 👀</Text>
              ) : (
                top.map((t, i) => (
                  <View
                    key={t.category}
                    style={{ paddingVertical: 12, borderBottomWidth: i === top.length - 1 ? 0 : 1, borderBottomColor: C.line }}
                  >
                    <View style={[s.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
                      <Text style={{ fontSize: 14.5, fontWeight: '800', color: C.ink }}>
                        {categoryEmoji(t.category)} {categoryLabel(t.category)}
                      </Text>
                      <Text style={{ fontSize: 14.5, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] }}>
                        {formatRs(t.total)}
                      </Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 5, backgroundColor: C.bg, overflow: 'hidden' }}>
                      <LinearGradient
                        colors={['#0E9F6E', '#14B8A6']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{ height: 8, borderRadius: 5, width: `${(t.total / maxCat) * 100}%` }}
                      />
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
