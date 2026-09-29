import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { C, s } from '../../components/theme';
import { Card, EmptyState, PrimaryButton, GhostButton, HeroCard, StatTile } from '../../components/ui';
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

  const balance = summary?.balance ?? 0;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.emerald} />}
      >
        <Text style={s.eyebrow}>paisa, sorted ✦</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>PocketHisaab</Text>

        {/* Balance hero */}
        <HeroCard
          eyebrow="total balance"
          value={formatSignedRs(balance)}
          valueColor={balance < 0 ? '#FDA4AF' : '#fff'}
          sub="Pocket money in, minus what you spent, lent out and owe."
        />

        {/* Stats grid */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <StatTile label="Spent · this month" value={formatRs(summary?.monthExpenses ?? 0)} tone="red" />
          <StatTile label="They owe you" value={formatRs(summary?.totalLent ?? 0)} tone="amber" />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <StatTile label="You owe" value={formatRs(summary?.totalBorrowed ?? 0)} tone="violet" />
          <StatTile
            label="Money in · total"
            value={formatRs(summary?.totalIncome ?? 0)}
            tone="sky"
            onPress={() => router.push('/income-list')}
          />
        </View>

        {/* Quick add */}
        <Text style={s.sectionTitle}>Quick add ⚡</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <QuickAction emoji="💸" label="Expense" colors={['#F43F5E', '#E11D48']} onPress={() => router.push('/add-expense')} />
          <QuickAction emoji="💰" label="Pocket money" colors={['#0E9F6E', '#14B8A6']} onPress={() => router.push('/add-income')} />
          <QuickAction emoji="🤝" label="Udhaar" colors={['#8B5CF6', '#6D28D9']} onPress={() => router.push('/add-udhaar')} />
        </View>

        {/* Recent activity */}
        <Text style={s.sectionTitle}>Recent activity</Text>
        {activity.length === 0 ? (
          <Card>
            <EmptyState
              emoji="🌱"
              title="Nothing here yet — let's fix that"
              body={
                isFresh
                  ? 'Add your first pocket money, log an expense, or record an udhaar to get the ball rolling.'
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
                    { paddingVertical: 12, borderBottomWidth: i === activity.length - 1 ? 0 : 1, borderBottomColor: C.line },
                  ]}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 16,
                      backgroundColor: meta.tint,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 13,
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{meta.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: -0.2 }}>{a.label}</Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
                      {a.sublabel} · {prettyDate(a.date)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '900',
                      color: a.kind === 'income' ? C.emeraldDark : a.kind === 'expense' ? C.redDark : C.amberDark,
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

        <Link href="/(tabs)/stats" style={{ marginTop: 20, textAlign: 'center', color: C.emeraldDark, fontWeight: '800', fontSize: 14.5 }}>
          View monthly stats →
        </Link>
      </ScrollView>

      {/* Update available modal */}
      <Modal visible={update !== null} transparent animationType="fade" onRequestClose={() => handleUpdateAction(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,31,22,0.55)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: C.card,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              paddingBottom: 38,
            }}
          >
            <Text style={{ fontSize: 42, textAlign: 'center' }}>🎉</Text>
            <Text style={[s.h2, { textAlign: 'center', marginTop: 10, fontSize: 21 }]}>
              Update available
            </Text>
            <Text style={[s.sub, { textAlign: 'center', marginTop: 8 }]}>
              PocketHisaab v{update?.latestVersion} is out. {update?.message}
            </Text>
            <View style={{ marginTop: 20, gap: 10 }}>
              <PrimaryButton title="Update now" onPress={() => handleUpdateAction(true)} />
              <GhostButton title="Later" onPress={() => handleUpdateAction(false)} />
            </View>
            <Text style={{ textAlign: 'center', color: C.inkFaint, fontSize: 12, marginTop: 14 }}>
              The new APK will download — open it to install.
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function QuickAction({
  emoji,
  label,
  colors,
  onPress,
}: {
  emoji: string;
  label: string;
  colors: [string, string];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
    >
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 20,
          paddingVertical: 18,
          alignItems: 'center',
          shadowColor: colors[0],
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 5,
        }}
      >
        <Text style={{ fontSize: 26 }}>{emoji}</Text>
        <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#fff', marginTop: 8 }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}
