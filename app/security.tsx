import { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { C, s } from '../components/theme';
import { Card, Field, GhostButton, PrimaryButton } from '../components/ui';
import { getLedger } from '../lib/finance/appLedger';
import { decryptBackup, encryptBackup } from '../lib/finance/backup';
import { changePin, disableLock, getLockState, setBiometricEnabled, setupPin } from '../lib/lock';

export default function SecurityScreen() {
  const ledger = getLedger();
  const [lockOn, setLockOn] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [useBio, setUseBio] = useState(true);

  const [exportPass, setExportPass] = useState('');
  const [exportPass2, setExportPass2] = useState('');
  const [importPass, setImportPass] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [st, has, enrolled] = await Promise.all([
      getLockState(),
      LocalAuthentication.hasHardwareAsync().catch(() => false),
      LocalAuthentication.isEnrolledAsync().catch(() => false),
    ]);
    setLockOn(st.enabled);
    setBiometricOn(st.biometric);
    setBiometricAvailable(has && enrolled);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const validPin = (p: string) => /^\d{4}$/.test(p);

  const doSetupPin = async () => {
    if (!validPin(newPin)) return Alert.alert('PIN format', 'Use exactly 4 digits.');
    if (newPin !== confirmPin) return Alert.alert('PIN mismatch', 'The two PINs do not match.');
    await setupPin(newPin, useBio && biometricAvailable);
    setNewPin('');
    setConfirmPin('');
    load();
    Alert.alert('App lock on', 'PocketHisaab will now ask for your PIN every time it opens or returns from the background.');
  };

  const doChangePin = async () => {
    if (!validPin(newPin)) return Alert.alert('PIN format', 'Use exactly 4 digits.');
    const ok = await changePin(oldPin, newPin);
    if (!ok) return Alert.alert('Wrong PIN', 'Your current PIN did not match.');
    setOldPin('');
    setNewPin('');
    Alert.alert('PIN changed', 'Your new PIN is active.');
  };

  const doDisable = async () => {
    const ok = await disableLock(oldPin);
    if (!ok) return Alert.alert('Wrong PIN', 'Enter your current PIN to turn the lock off.');
    setOldPin('');
    load();
  };

  const doExport = async () => {
    if (exportPass.length < 8) return Alert.alert('Passphrase too short', 'Use at least 8 characters — this passphrase is the only key to the backup.');
    if (exportPass !== exportPass2) return Alert.alert('Passphrase mismatch', 'The two passphrases do not match.');
    setBusy(true);
    try {
      const data = await ledger.exportBackupData();
      const text = encryptBackup(data, exportPass, (n) => Crypto.getRandomBytes(n));
      const date = new Date().toISOString().slice(0, 10);
      const uri = `${FileSystem.cacheDirectory}pockethisaab-backup-${date}.phbk`;
      await FileSystem.writeAsStringAsync(uri, text);
      setExportPass('');
      setExportPass2('');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save your PocketHisaab backup' });
      } else {
        Alert.alert('Backup written', `Saved inside the app cache: ${uri}`);
      }
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const doImport = async () => {
    if (!importPass) return Alert.alert('Passphrase needed', 'Enter the passphrase you set when creating the backup.');
    setBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (picked.canceled) {
        setBusy(false);
        return;
      }
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const data = decryptBackup(text, importPass);
      const result = await ledger.importBackupData(data);
      setImportPass('');
      Alert.alert(
        'Backup restored',
        `${result.transactions} transactions restored and the ledger passed its integrity check. Your hisaab is back.`,
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>Security & backup</Text>
        <Text style={s.sub}>Your ledger lives only on this phone. Lock it, and keep an encrypted backup you control.</Text>

        <Text style={s.sectionTitle}>App lock 🔒</Text>
        {!lockOn ? (
          <Card>
            <Text style={{ fontSize: 15.5, fontWeight: '800', color: C.ink }}>Set a 4-digit PIN</Text>
            <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 5, lineHeight: 19 }}>
              The app will ask for it on every open. Your PIN is stored only as a salted hash in the
              phone's secure storage — never in the database.
            </Text>
            <View style={{ height: 12 }} />
            <Field label="New PIN (4 digits)" value={newPin} onChangeText={setNewPin} keyboardType="numeric" placeholder="••••" />
            <Field label="Confirm PIN" value={confirmPin} onChangeText={setConfirmPin} keyboardType="numeric" placeholder="••••" />
            {biometricAvailable && (
              <View style={[s.row, { justifyContent: 'space-between', marginBottom: 12 }]}>
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: C.ink, marginRight: 10 }}>Also unlock with fingerprint / face</Text>
                <Switch value={useBio} onValueChange={setUseBio} trackColor={{ false: C.line, true: C.emerald }} />
              </View>
            )}
            <PrimaryButton title="Turn on app lock" onPress={doSetupPin} />
          </Card>
        ) : (
          <Card>
            <Text style={{ fontSize: 15.5, fontWeight: '800', color: C.emeraldDark }}>✓ App lock is ON</Text>
            {biometricAvailable && (
              <View style={[s.row, { justifyContent: 'space-between', marginTop: 14 }]}>
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: C.ink, marginRight: 10 }}>Biometric unlock</Text>
                <Switch
                  value={biometricOn}
                  onValueChange={async (v) => {
                    setBiometricOn(v);
                    await setBiometricEnabled(v);
                  }}
                  trackColor={{ false: C.line, true: C.emerald }}
                />
              </View>
            )}
            <View style={{ height: 14 }} />
            <Field label="Current PIN" value={oldPin} onChangeText={setOldPin} keyboardType="numeric" placeholder="••••" />
            <Field label="New PIN (only to change)" value={newPin} onChangeText={setNewPin} keyboardType="numeric" placeholder="••••" />
            <GhostButton title="Change PIN" onPress={doChangePin} />
            <View style={{ height: 10 }} />
            <GhostButton title="Turn off app lock" onPress={doDisable} />
            <Text style={{ fontSize: 12, color: C.inkFaint, marginTop: 10, lineHeight: 17 }}>
              Forgot your PIN? There is no recovery — by design. You would need to reinstall the app
              (which erases the on-device ledger) or restore an encrypted backup on a fresh install.
            </Text>
          </Card>
        )}

        <Text style={s.sectionTitle}>Encrypted backup 💾</Text>
        <Card>
          <Text style={{ fontSize: 15.5, fontWeight: '800', color: C.ink }}>Back up your hisaab</Text>
          <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 5, lineHeight: 19 }}>
            Creates one encrypted backup file (PBKDF2 + AES-256) holding your complete ledger —
            wallets, transactions, udhaar, people, categories and import history. Save it somewhere
            safe (Drive, email to yourself, a USB stick). Without the passphrase, nobody can open it.
          </Text>
          <View style={{ height: 12 }} />
          <Field label="Backup passphrase (min 8 characters)" value={exportPass} onChangeText={setExportPass} placeholder="Choose a strong passphrase" autoCapitalize="none" />
          <Field label="Repeat passphrase" value={exportPass2} onChangeText={setExportPass2} placeholder="Repeat it" autoCapitalize="none" />
          <PrimaryButton title={busy ? 'Working…' : 'Create & share backup'} onPress={doExport} disabled={busy} />
        </Card>

        <Card style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 15.5, fontWeight: '800', color: C.ink }}>Restore a backup</Text>
          <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 5, lineHeight: 19 }}>
            Restore works only into an <Text style={{ fontWeight: '800' }}>empty ledger</Text> (fresh
            install, or after a controlled reset) — it never merges into existing data, and the
            restored ledger must pass a full integrity check before it is kept. Your current data is
            never touched by a failed restore.
          </Text>
          <View style={{ height: 12 }} />
          <Field label="Backup passphrase" value={importPass} onChangeText={setImportPass} placeholder="The passphrase from backup time" autoCapitalize="none" />
          <GhostButton title={busy ? 'Working…' : 'Choose backup file & restore'} onPress={doImport} />
        </Card>

        <Card style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 15.5, fontWeight: '800', color: C.ink }}>Privacy, plainly</Text>
          <Text style={{ fontSize: 13, color: C.inkSoft, marginTop: 5, lineHeight: 19 }}>
            PocketHisaab has no servers and no accounts. Names and notes are encrypted inside the
            on-device database, transaction parsing happens on this phone, and nothing is uploaded
            anywhere. The only network calls the app makes are the update check (version.json) and
            links you open yourself.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
