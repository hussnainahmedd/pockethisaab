import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, GhostButton } from '../components/ui';
import {
  META_NOTIF,
  META_SMS,
  hasNotificationAccess,
  hasSmsPermission,
  isAutofetchEnabled,
  requestSmsPermission,
  setAutofetchEnabled,
  setNotifChannelEnabled,
  setSmsChannelEnabled,
} from '../lib/autofetch/service';
import { getMetaValue, setMetaValue } from '../lib/db';
import { isAutofetchNativeAvailable, openNotificationListenerSettings } from '../modules/transaction-autofetch/src';

export default function AutofetchSettings() {
  const [supported] = useState(isAutofetchNativeAvailable());
  const [enabled, setEnabled] = useState(false);
  const [smsOn, setSmsOn] = useState(false);
  const [notifOn, setNotifOn] = useState(false);
  const [smsGranted, setSmsGranted] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const [skipSelf, setSkipSelf] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [en, sOn, nOn, sGr, skip] = await Promise.all([
      isAutofetchEnabled(),
      getMetaValue(META_SMS).then((v: string | null) => v === '1'),
      getMetaValue(META_NOTIF).then((v: string | null) => v === '1'),
      hasSmsPermission(),
      getMetaValue('af_skip_self_transfers').then((v: string | null) => v !== '0'),
    ]);
    setEnabled(en);
    setSmsOn(sOn);
    setNotifOn(nOn);
    setSmsGranted(sGr);
    setSkipSelf(skip);
    setNotifGranted(hasNotificationAccess());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggleMaster = async (v: boolean) => {
    setBusy(true);
    await setAutofetchEnabled(v);
    setEnabled(v);
    setBusy(false);
  };

  const enableSms = async () => {
    setBusy(true);
    const granted = await requestSmsPermission();
    setSmsGranted(granted);
    if (granted) {
      await setSmsChannelEnabled(true);
      setSmsOn(true);
      if (!enabled) {
        await setAutofetchEnabled(true);
        setEnabled(true);
      }
    } else {
      Alert.alert(
        'SMS permission needed',
        'Auto-fetch needs SMS access to read transaction alerts from your bank and wallets. Nothing leaves your phone.',
      );
    }
    setBusy(false);
  };

  const disableSms = async () => {
    await setSmsChannelEnabled(false);
    setSmsOn(false);
  };

  const enableNotif = async () => {
    if (!enabled) {
      await setAutofetchEnabled(true);
      setEnabled(true);
    }
    await setNotifChannelEnabled(true);
    setNotifOn(true);
    openNotificationListenerSettings();
    Alert.alert(
      'One more step',
      'In the system settings that just opened, turn on Notification Access for PocketHisaab. Then come back here.',
    );
  };

  const disableNotif = async () => {
    await setNotifChannelEnabled(false);
    setNotifOn(false);
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.eyebrow}>set it and forget it ✦</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>Auto-fetch ⚡</Text>
        <Text style={[s.sub, { marginTop: 8 }]}>
          When your bank or wallet sends a transaction SMS or push notification, PocketHisaab logs it
          automatically — no typing, no confirm taps.
        </Text>

        {!supported && (
          <Card style={{ marginTop: 16, backgroundColor: C.amberSoft }}>
            <Text style={{ fontWeight: '800', color: C.ink }}>Not available in this build</Text>
            <Text style={{ color: C.inkSoft, marginTop: 6, fontSize: 13.5 }}>
              Auto-fetch needs the installed APK (it can't run inside Expo Go previews).
            </Text>
          </Card>
        )}

        {/* Master switch */}
        <Card style={{ marginTop: 16 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: C.ink }}>Auto-fetch</Text>
              <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 4 }}>
                Turn the whole thing on or off in one tap.
              </Text>
            </View>
            <Switch
              value={enabled}
              disabled={busy || !supported}
              onValueChange={toggleMaster}
              trackColor={{ false: C.line, true: C.emerald }}
            />
          </View>
        </Card>

        {/* SMS channel */}
        <Text style={s.sectionTitle}>SMS channel</Text>
        <Card>
          <StatusRow
            emoji="💬"
            title="Bank & wallet SMS"
            desc="JazzCash, Easypaisa, HBL, MCB, UBL, Meezan, Allied, Faysal Bank and more."
            active={smsOn && smsGranted}
            activeLabel={smsGranted ? (smsOn ? 'Reading SMS' : 'Permission granted') : 'Permission needed'}
          />
          <View style={{ marginTop: 12 }}>
            {smsGranted ? (
              smsOn ? (
                <GhostButton title="Turn off SMS reading" onPress={disableSms} />
              ) : (
                <GhostButton
                  title="Turn on SMS reading"
                  onPress={async () => {
                    await setSmsChannelEnabled(true);
                    setSmsOn(true);
                  }}
                />
              )
            ) : (
              <GhostButton title="Grant SMS permission" onPress={enableSms} />
            )}
          </View>
          <Text style={{ fontSize: 12, color: C.inkFaint, marginTop: 10 }}>
            First enable imports the last 7 days of transaction SMS. Only messages from known
            bank/wallet senders are ever parsed.
          </Text>
        </Card>

        {/* Notification channel */}
        <Text style={s.sectionTitle}>Notification channel</Text>
        <Card>
          <StatusRow
            emoji="🔔"
            title="Finance app notifications"
            desc="SadaPay, NayaPay, Finja — they send push notifications instead of SMS."
            active={notifOn && notifGranted}
            activeLabel={notifGranted ? (notifOn ? 'Listening' : 'Access granted') : 'Access needed'}
          />
          <View style={{ marginTop: 12 }}>
            {notifOn ? (
              <GhostButton title="Turn off notification listening" onPress={disableNotif} />
            ) : (
              <GhostButton title="Enable notification access" onPress={enableNotif} />
            )}
          </View>
          <Text style={{ fontSize: 12, color: C.inkFaint, marginTop: 10 }}>
            This opens a system settings screen — it's a special Android permission, not a popup.
            Only notifications from finance apps are read; everything else is ignored.
          </Text>
        </Card>

        {/* Self-transfers */}
        <Text style={s.sectionTitle}>Self-transfers</Text>
        <Card>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: C.ink }}>Skip my own transfers</Text>
              <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 4 }}>
                When you move money between your own accounts (Easypaisa → JazzCash), the send and
                receive cancel out — neither is logged.
              </Text>
            </View>
            <Switch
              value={skipSelf}
              disabled={busy}
              onValueChange={async (v) => {
                setSkipSelf(v);
                await setMetaValue('af_skip_self_transfers', v ? '1' : '0');
              }}
              trackColor={{ false: C.line, true: C.emerald }}
            />
          </View>
        </Card>

        {/* Safety + privacy */}
        <Text style={s.sectionTitle}>How it stays safe</Text>
        <Card>
          <Bullet text="Only messages matching a known transaction format are logged — anything unclear is skipped, never guessed." />
          <Bullet text="Every transaction ID is remembered, so nothing is ever added twice." />
          <Bullet text="Auto-added entries carry a ⚡ tag and stay fully editable and deletable." />
          <Bullet text="Parsing happens 100% on your phone. No message ever leaves the device." />
        </Card>

        <View style={{ marginTop: 18 }}>
          <GhostButton title="← Back" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusRow({
  emoji,
  title,
  desc,
  active,
  activeLabel,
}: {
  emoji: string;
  title: string;
  desc: string;
  active: boolean;
  activeLabel: string;
}) {
  return (
    <View style={[s.row, { alignItems: 'flex-start' }]}>
      <Text style={{ fontSize: 26, marginRight: 12 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15.5, fontWeight: '900', color: C.ink }}>{title}</Text>
        <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 4 }}>{desc}</Text>
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 8,
            backgroundColor: active ? C.emeraldSoft : C.line,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '800', color: active ? C.emeraldDark : C.inkSoft }}>
            {active ? '● ' : '○ '}
            {activeLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={[s.row, { alignItems: 'flex-start', marginTop: 10 }]}>
      <Text style={{ color: C.emeraldDark, fontWeight: '900', marginRight: 8 }}>✓</Text>
      <Text style={{ flex: 1, fontSize: 13.5, color: C.inkSoft, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}
