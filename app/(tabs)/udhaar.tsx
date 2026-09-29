import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, EmptyState } from '../../components/ui';
import { getPeople, type PersonSummary } from '../../lib/db';
import { formatRs } from '../../lib/format';

export default function Udhaar() {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setPeople(await getPeople());
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

  const totalOwedToMe = people.reduce((a, p) => a + Math.max(0, p.net), 0);
  const totalIOwe = people.reduce((a, p) => a + Math.max(0, -p.net), 0);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>Udhaar</Text>
            <Text style={s.sub}>Who owes you, and who you owe.</Text>
          </View>
          <Pressable
            onPress={() => router.push('/add-udhaar')}
            style={({ pressed }) => ({
              backgroundColor: C.emerald,
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 11,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>+ New</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <View style={{ flex: 1, backgroundColor: C.emeraldSoft, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.inkSoft }}>They owe you</Text>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.emeraldDark, marginTop: 6, fontVariant: ['tabular-nums'] }}>
              {formatRs(totalOwedToMe)}
            </Text>
          </View>
          <View style={{ flex: 1, backgroundColor: C.redSoft, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.inkSoft }}>You owe</Text>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.red, marginTop: 6, fontVariant: ['tabular-nums'] }}>
              {formatRs(totalIOwe)}
            </Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>People</Text>
        {people.length === 0 ? (
          <Card>
            <EmptyState
              emoji="🤝"
              title="No udhaar recorded"
              body="Lent money to a friend or borrowed some? Tap + New to write it down so nobody forgets."
            />
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {people.map((p, i) => {
              const positive = p.net >= 0;
              return (
                <Pressable
                  key={p.name}
                  onPress={() => router.push({ pathname: '/person/[name]', params: { name: p.name } })}
                  style={({ pressed }) => [
                    s.row,
                    {
                      paddingVertical: 13,
                      paddingHorizontal: 8,
                      borderBottomWidth: i === people.length - 1 ? 0 : 1,
                      borderBottomColor: C.line,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: positive ? C.emeraldSoft : C.redSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontSize: 17, fontWeight: '800', color: positive ? C.emeraldDark : C.red }}>
                      {p.name.trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15.5, fontWeight: '700', color: C.ink }}>{p.name}</Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>
                      {p.openCount} open {p.openCount === 1 ? 'entry' : 'entries'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={{
                        fontSize: 15.5,
                        fontWeight: '800',
                        color: positive ? C.emeraldDark : C.red,
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {positive ? '+' : '−'}
                      {formatRs(Math.abs(p.net))}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 2 }}>
                      {positive ? 'owes you' : 'you owe'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
