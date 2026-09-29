import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Link, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { C, s } from '../../components/theme';
import { Card, EmptyState, PrimaryButton, GhostButton, StatTile } from '../../components/ui';
import { getDashboardSummary, getRecentActivity, type ActivityItem, type DashboardSummary } from '../../lib/db';
import { formatRs, formatSignedRs, prettyDate } from '../../lib/format';
import {
  checkForUpdate,
  getLastPromptedVersion,
  setLastPromptedVersion,
  type RemoteVersion,
} from '../../lib/update';

const ACTIVITY_META: Record<ActivityItem['kind'], { emoji: string; tint: string }> = {
  income: { emoji: '💰', tint: C.emeraldSoft },
  expense: { emoji: '💸', tint: C.redSoft },
  udhaar: { emoji: '🤝', tint: C.amberSoft },
};

export default function Home() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [sum, act] = await Promise.all([getDashboardSummary(), getRecentActivity(8)]);
    setSummary(sum);
    setActivity(act);
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

  const isFresh = summary && summary.totalIncome === 0 && summary.totalExpenses === 0 && summary.totalLent === 0 && summary.totalBorrowed === 0;

  /* ---- In-app update check (silent when offline) ---- */
  const [update, setUpdate] = useState<RemoteVersion | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = Constants.expoConfig?.version ?? '0.0.0';
      const remote = await checkForUpdate(current);
      if (!remote || cancelled) return;
      const prompted = await getLastPromptedVersion();
      if (prompted === remote.latestVersion || cancelled) return; // don't nag
      setUpdate(remote);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdateAction = async (openLink: boolean) => {
    if (!update) return;
    const v = update.latestVersion;
    const url = update.apkUrl;
    setUpdate(null);
    await setLastPromptedVersion(v); // remember — only prompt again on a newer version
    if (openLink) {
      try {
        await Linking.openURL(url);
      } catch {
        // silent: user can retry from the GitHub releases page
      }
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <Text style={s.h1}>PocketHisaab</Text>
        <Text style={s.sub}>Your money, your udhaar — all in one place.</Text>

        {/* Balance hero */}
        <Card style={{ marginTop: 18, backgroundColor: C.navy, borderColor: C.navy }}>
          <Text style={{ color: '#9FC4B8', fontSize: 13, fontWeight: '600' }}>TOTAL BALANCE</Text>
          <Text
            style={{
              color: (summary?.balance ?? 0) < 0 ? '#FF9B9E' : '#fff',
              fontSize: 38,
              fontWeight: '800',
              marginTop: 6,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatSignedRs(summary?.balance ?? 0)}
          </Text>
          <Text style={{ color: '#9FC4B8', fontSize: 12.5, marginTop: 8 }}>
            Pocket money in, minus what you spent, lent out and owe.
          </Text>
        </Card>

        {/* Stats grid */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <StatTile label="Spent (this month)" value={formatRs(summary?.monthExpenses ?? 0)} tone="red" />
          <StatTile label="They owe you" value={formatRs(summary?.totalLent ?? 0)} tone="amber" />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <StatTile label="You owe" value={formatRs(summary?.totalBorrowed ?? 0)} tone="red" />
          <StatTile label="Money in (total)" value={formatRs(summary?.totalIncome ?? 0)} tone="green" />
        </View>

        {/* Quick add */}
        <Text style={s.sectionTitle}>Quick add</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <QuickAction emoji="💸" label="Expense" onPress={() => router.push('/add-expense')} />
          <QuickAction emoji="💰" label="Pocket money" onPress={() => router.push('/add-income')} />
          <QuickAction emoji="🤝" label="Udhaar" onPress={() => router.push('/add-udhaar')} />
        </View>

        {/* Recent activity */}
        <Text style={s.sectionTitle}>Recent activity</Text>
        {activity.length === 0 ? (
          <Card>
            <EmptyState
              emoji="🌱"
              title="Nothing here yet"
              body={
                isFresh
                  ? 'Add your first pocket money, log an expense, or record an udhaar to get started.'
                  : 'No recent activity.'
              }
            />
          </Card>
        ) : (
          <Card style={{ paddingVertical: 6 }}>
            {activity.map((a, i) => {
              const meta = ACTIVITY_META[a.kind];
              return (
                <View
                  key={`${a.kind}-${a.id}`}
                  style={[
                    s.row,
                    { paddingVertical: 11, borderBottomWidth: i === activity.length - 1 ? 0 : 1, borderBottomColor: C.line },
                  ]}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: meta.tint,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontSize: 19 }}>{meta.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }}>{a.label}</Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>
                      {a.sublabel} · {prettyDate(a.date)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 14.5,
                      fontWeight: '800',
                      color: a.kind === 'income' ? C.emeraldDark : a.kind === 'expense' ? C.red : C.amber,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {a.kind === 'income' ? '+' : a.kind === 'expense' ? '−' : ''}
                    {formatRs(a.amount)}
                  </Text>
                </View>
              );
            })}
          </Card>
        )}

        <Link href="/(tabs)/stats" style={{ marginTop: 18, textAlign: 'center', color: C.emeraldDark, fontWeight: '700', fontSize: 14 }}>
          View monthly stats →
        </Link>
      </ScrollView>

      {/* Update available modal */}
      <Modal visible={update !== null} transparent animationType="fade" onRequestClose={() => handleUpdateAction(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,30,27,0.5)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: C.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 22,
              paddingBottom: 34,
            }}
          >
            <Text style={{ fontSize: 40, textAlign: 'center' }}>🎉</Text>
            <Text style={[s.h2, { textAlign: 'center', marginTop: 8, fontSize: 20 }]}>
              Update available
            </Text>
            <Text style={[s.sub, { textAlign: 'center', marginTop: 8 }]}>
              PocketHisaab v{update?.latestVersion} is out. {update?.message}
            </Text>
            <View style={{ marginTop: 18, gap: 10 }}>
              <PrimaryButton title="Update now" onPress={() => handleUpdateAction(true)} />
              <GhostButton title="Later" onPress={() => handleUpdateAction(false)} />
            </View>
            <Text style={{ textAlign: 'center', color: C.inkFaint, fontSize: 12, marginTop: 12 }}>
              The new APK will download — open it to install.
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function QuickAction({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: '#fff',
          borderRadius: 14,
          borderWidth: 1,
          borderColor: C.line,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ fontSize: 24 }}>{emoji}</Text>
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: C.ink, marginTop: 6 }}>{label}</Text>
    </Pressable>
  );
}
