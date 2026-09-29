import { useCallback, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
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
            <Text style={s.eyebrow}>hisab kitab ✦</Text>
            <Text style={[s.h1, { marginTop: 4 }]}>Udhaar</Text>
          </View>
          <Pressable
            onPress={() => router.push('/add-udhaar')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
          >
            <LinearGradient
              colors={['#0E9F6E', '#14B8A6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 999,
                paddingHorizontal: 18,
                paddingVertical: 13,
                shadowColor: '#0E9F6E',
                shadowOpacity: 0.4,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 5 },
                elevation: 5,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>+ New</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <View style={{ flex: 1, backgroundColor: C.emeraldSoft, borderRadius: 20, padding: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1, color: C.emeraldDark, textTransform: 'uppercase' }}>
              They owe you
            </Text>
            <Text style={{ fontSize: 19, fontWeight: '900', color: C.emeraldDark, marginTop: 8, fontVariant: ['tabular-nums'], letterSpacing: -0.4 }}>
              {formatRs(totalOwedToMe)}
            </Text>
          </View>
          <View style={{ flex: 1, backgroundColor: C.redSoft, borderRadius: 20, padding: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1, color: C.redDark, textTransform: 'uppercase' }}>
              You owe
            </Text>
            <Text style={{ fontSize: 19, fontWeight: '900', color: C.redDark, marginTop: 8, fontVariant: ['tabular-nums'], letterSpacing: -0.4 }}>
              {formatRs(totalIOwe)}
            </Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>People</Text>
        {people.length === 0 ? (
          <Card>
            <EmptyState
              emoji="🤝"
              title="No udhaar recorded — yet"
              body="Lent money to Ahmed or borrowed from Fatima? Tap + New and write it down so nobody forgets."
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
                      paddingVertical: 14,
                      paddingHorizontal: 6,
                      borderBottomWidth: i === people.length - 1 ? 0 : 1,
                      borderBottomColor: C.line,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 18,
                      backgroundColor: positive ? C.emeraldSoft : C.redSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 13,
                    }}
                  >
                    <Text style={{ fontSize: 19, fontWeight: '900', color: positive ? C.emeraldDark : C.redDark }}>
                      {p.name.trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink, letterSpacing: -0.2 }}>{p.name}</Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
                      {p.openCount} open {p.openCount === 1 ? 'entry' : 'entries'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '900',
                        color: positive ? C.emeraldDark : C.redDark,
                        fontVariant: ['tabular-nums'],
                        letterSpacing: -0.3,
                      }}
                    >
                      {positive ? '+' : '−'}
                      {formatRs(Math.abs(p.net))}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 3, fontWeight: '600' }}>
                      {positive ? 'owes you' : 'you owe'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
        {people.length > 0 && (
          <Text style={{ textAlign: 'center', color: C.inkFaint, fontSize: 12, marginTop: 14 }}>
            Open a person, then long-press any entry to edit or delete it.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
