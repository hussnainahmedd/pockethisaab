import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, EmptyState } from '../../components/ui';
import { getPersonEntries, getPersonTotals, setUdhaarSettled, type UdhaarEntry } from '../../lib/db';
import { formatRs, prettyDate } from '../../lib/format';

export default function PersonDetail() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const person = Array.isArray(name) ? name[0] : name ?? '';
  const [entries, setEntries] = useState<UdhaarEntry[]>([]);
  const [totals, setTotals] = useState({ lent: 0, borrowed: 0, settled: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!person) return;
    const [e, t] = await Promise.all([getPersonEntries(person), getPersonTotals(person)]);
    setEntries(e);
    setTotals(t);
  }, [person]);

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

  const toggle = async (entry: UdhaarEntry) => {
    await setUdhaarSettled(entry.id, entry.settled === 0);
    load();
  };

  const net = totals.lent - totals.borrowed;

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: person || 'Person' }} />
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <Card style={{ backgroundColor: C.navy, borderColor: C.navy }}>
          <Text style={{ color: '#9FC4B8', fontSize: 12.5, fontWeight: '600' }}>NET WITH {person.toUpperCase()}</Text>
          <Text
            style={{
              color: '#fff',
              fontSize: 30,
              fontWeight: '800',
              marginTop: 6,
              fontVariant: ['tabular-nums'],
            }}
          >
            {net > 0 ? '+' : net < 0 ? '−' : ''}
            {formatRs(Math.abs(net))}
          </Text>
          <Text style={{ color: '#9FC4B8', fontSize: 12.5, marginTop: 6 }}>
            {net > 0 ? `${person} owes you` : net < 0 ? `You owe ${person}` : 'All settled up'}
            {totals.settled > 0 ? ` · ${totals.settled} settled` : ''}
          </Text>
        </Card>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={() => router.push({ pathname: '/add-udhaar', params: { person } })}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1 })}
          >
            <View style={{ backgroundColor: C.emerald, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14.5 }}>+ New entry</Text>
            </View>
          </Pressable>
        </View>

        <Text style={s.sectionTitle}>History</Text>
        {entries.length === 0 ? (
          <Card>
            <EmptyState emoji="📝" title="No entries" body="Nothing recorded with this person yet." />
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {entries.map((e, i) => {
              const settled = e.settled === 1;
              return (
                <View
                  key={e.id}
                  style={[
                    s.row,
                    { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: i === entries.length - 1 ? 0 : 1, borderBottomColor: C.line, opacity: settled ? 0.55 : 1 },
                  ]}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 13,
                      backgroundColor: e.direction === 'lent' ? C.emeraldSoft : C.redSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{e.direction === 'lent' ? '📤' : '📥'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }}>
                      {e.direction === 'lent' ? 'You lent' : 'You borrowed'}
                      {e.note ? ` · ${e.note}` : ''}
                    </Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>{prettyDate(e.date)}</Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 14.5,
                      fontWeight: '800',
                      color: e.direction === 'lent' ? C.emeraldDark : C.red,
                      fontVariant: ['tabular-nums'],
                      marginRight: 10,
                    }}
                  >
                    {formatRs(e.amount)}
                  </Text>
                  <Pressable
                    onPress={() => toggle(e)}
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      backgroundColor: settled ? C.emeraldSoft : C.bg,
                      borderWidth: 1,
                      borderColor: settled ? C.emerald : C.line,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: settled ? C.emeraldDark : C.inkSoft }}>
                      {settled ? '✓ Settled' : 'Settle'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
