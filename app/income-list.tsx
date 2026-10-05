import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, EmptyState } from '../components/ui';
import { deleteIncome, getAllIncome, type Income } from '../lib/db';
import { formatRs, prettyDate } from '../lib/format';

export default function IncomeList() {
  const [entries, setEntries] = useState<Income[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setEntries(await getAllIncome());
  }, []);

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

  const total = entries.reduce((a, e) => a + e.amount, 0);

  const askDelete = (entry: Income) => {
    Alert.alert('Delete income?', `"${entry.source}" (${formatRs(entry.amount)}) will be removed permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteIncome(entry.id);
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
        <Text style={s.eyebrow}>income ledger ✦</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>Pocket Money</Text>
        <Text style={s.sub}>Every entry, editable. Tap ✏️ to fix, 🗑️ to remove.</Text>

        <Card style={{ marginTop: 18, backgroundColor: C.skySoft, borderColor: '#BAE6FD' }}>
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: '#0369A1', textTransform: 'uppercase' }}>
            Total money in
          </Text>
          <Text style={{ fontSize: 30, fontWeight: '900', color: '#0C4A6E', marginTop: 6, fontVariant: ['tabular-nums'], letterSpacing: -0.5 }}>
            {formatRs(total)}
          </Text>
          <Text style={{ fontSize: 12.5, color: '#0369A1', marginTop: 4 }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </Text>
        </Card>

        {entries.length === 0 ? (
          <View style={{ marginTop: 14 }}>
            <Card>
              <EmptyState
                emoji="💸"
                title="No pocket money yet"
                body="Tap + Add below to record the money you received."
              />
            </Card>
          </View>
        ) : (
          <Card style={{ paddingVertical: 6, marginTop: 14 }}>
            {entries.map((e, i) => (
              <View
                key={e.id}
                style={[
                  s.row,
                  { paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: i === entries.length - 1 ? 0 : 1, borderBottomColor: C.line },
                ]}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 16,
                    backgroundColor: C.emeraldSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 13,
                  }}
                >
                  <Text style={{ fontSize: 20 }}>💰</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: -0.2 }}>{e.source}</Text>
                  <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
                    {[e.note, prettyDate(e.date)].filter(Boolean).join(' · ')}
                    {e.origin === 'auto' ? ' ⚡' : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 15.5, fontWeight: '900', color: C.emeraldDark, fontVariant: ['tabular-nums'], marginRight: 10 }}>
                  +{formatRs(e.amount)}
                </Text>
                <Pressable
                  onPress={() => router.push({ pathname: '/edit-income', params: { id: String(e.id) } })}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
                    borderRadius: 14,
                    backgroundColor: C.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 6,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: 16 }}>✏️</Text>
                </Pressable>
                <Pressable
                  onPress={() => askDelete(e)}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
                    borderRadius: 14,
                    backgroundColor: C.redSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: 16 }}>🗑️</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <Pressable
          onPress={() => router.push('/add-income')}
          style={({ pressed }) => ({
            marginTop: 18,
            backgroundColor: C.emerald,
            borderRadius: 18,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
            shadowColor: C.emerald,
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 5,
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>+ Add Pocket Money</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
