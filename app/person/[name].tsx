import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, EmptyState, HeroCard } from '../../components/ui';
import {
  deleteUdhaar,
  getPersonEntries,
  getPersonTotals,
  setUdhaarSettled,
  type UdhaarEntry,
} from '../../lib/db';
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

  const rowActions = (entry: UdhaarEntry) => {
    Alert.alert(
      entry.direction === 'lent' ? `Lent · ${formatRs(entry.amount)}` : `Borrowed · ${formatRs(entry.amount)}`,
      'What do you want to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '✏️ Edit',
          onPress: () => router.push({ pathname: '/edit-udhaar', params: { id: String(entry.id) } }),
        },
        {
          text: '🗑️ Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Delete entry?', 'This entry will be removed permanently and balances will update.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await deleteUdhaar(entry.id);
                  load();
                },
              },
            ]),
        },
      ],
    );
  };

  const net = totals.lent - totals.borrowed;

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: person || 'Person' }} />
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <HeroCard
          eyebrow={`net with ${person.toUpperCase()}`}
          value={`${net > 0 ? '+' : net < 0 ? '−' : ''}${formatRs(Math.abs(net))}`}
          valueColor={net < 0 ? '#FDA4AF' : '#fff'}
          sub={`${net > 0 ? `${person} owes you` : net < 0 ? `You owe ${person}` : 'All settled up ✨'}${totals.settled > 0 ? ` · ${totals.settled} settled` : ''}`}
        />

        <Pressable
          onPress={() => router.push({ pathname: '/add-udhaar', params: { person } })}
          style={({ pressed }) => ({
            marginTop: 14,
            backgroundColor: C.emerald,
            borderRadius: 18,
            paddingVertical: 15,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
            shadowColor: C.emerald,
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 5,
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>+ New entry</Text>
        </Pressable>

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
                <Pressable
                  key={e.id}
                  onLongPress={() => rowActions(e)}
                  delayLongPress={350}
                  style={[
                    s.row,
                    {
                      paddingVertical: 13,
                      paddingHorizontal: 6,
                      borderBottomWidth: i === entries.length - 1 ? 0 : 1,
                      borderBottomColor: C.line,
                      opacity: settled ? 0.55 : 1,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 16,
                      backgroundColor: e.direction === 'lent' ? C.emeraldSoft : C.redSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 13,
                    }}
                  >
                    <Text style={{ fontSize: 19 }}>{e.direction === 'lent' ? '📤' : '📥'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: -0.2 }}>
                      {e.direction === 'lent' ? 'You lent' : 'You borrowed'}
                      {e.note ? ` · ${e.note}` : ''}
                    </Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>{prettyDate(e.date)}</Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '900',
                      color: e.direction === 'lent' ? C.emeraldDark : C.redDark,
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
                      paddingHorizontal: 13,
                      paddingVertical: 8,
                      backgroundColor: settled ? C.emeraldSoft : C.bg,
                      borderWidth: 1.5,
                      borderColor: settled ? C.emerald : C.line,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: settled ? C.emeraldDark : C.inkSoft }}>
                      {settled ? '✓ Settled' : 'Settle'}
                    </Text>
                  </Pressable>
                </Pressable>
              );
            })}
          </Card>
        )}
        {entries.length > 0 && (
          <Text style={{ textAlign: 'center', color: C.inkFaint, fontSize: 12, marginTop: 14 }}>
            Long-press an entry to edit or delete it.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
