import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { C, s } from './theme';
import { checkPin, getLockState } from '../lib/lock';

/**
 * Full-screen PIN gate (M6). Shown by the root layout whenever the app
 * is locked: cold start with a PIN set, and every return from
 * background. Biometric unlock is attempted automatically when the
 * user enabled it; the PIN pad is always available as the fallback.
 */
export default function LockGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [biometricOn, setBiometricOn] = useState(false);

  const tryBiometric = async () => {
    try {
      const state = await getLockState();
      if (!state.biometric) return;
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!has || !enrolled) return;
      setBiometricOn(true);
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock PocketHisaab',
        fallbackLabel: 'Use PIN',
      });
      if (res.success) onUnlock();
    } catch {
      // fall through to PIN
    }
  };

  useEffect(() => {
    tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = async (d: string) => {
    if (d === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setError(null);
    if (next.length === 4) {
      const ok = await checkPin(next);
      if (ok) {
        onUnlock();
      } else {
        setError('Wrong PIN — try again');
        setPin('');
      }
    }
  };

  const Key = ({ label, value }: { label: string; value: string }) => (
    <Pressable
      onPress={() => press(value)}
      style={({ pressed }) => ({
        width: 74,
        height: 74,
        borderRadius: 37,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? C.emeraldSoft : C.card,
        borderWidth: 1.5,
        borderColor: C.line,
        margin: 7,
      })}
    >
      <Text style={{ fontSize: 25, fontWeight: '800', color: C.ink }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View
        style={{
          width: 74, height: 74, borderRadius: 24, backgroundColor: C.emeraldDeep,
          alignItems: 'center', justifyContent: 'center', marginBottom: 18,
        }}
      >
        <Text style={{ fontSize: 30 }}>🔒</Text>
      </View>
      <Text style={s.h1}>PocketHisaab</Text>
      <Text style={[s.sub, { textAlign: 'center' }]}>Enter your 4-digit PIN to open your hisaab.</Text>
      <View style={{ flexDirection: 'row', marginVertical: 26, gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              width: 15, height: 15, borderRadius: 8,
              backgroundColor: i < pin.length ? C.emerald : 'transparent',
              borderWidth: 2, borderColor: C.emerald,
            }}
          />
        ))}
      </View>
      {error && <Text style={{ color: C.redDark, fontWeight: '800', marginBottom: 12 }}>{error}</Text>}
      <View>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ].map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row' }}>
            {row.map((d) => (
              <Key key={d} label={d} value={d} />
            ))}
          </View>
        ))}
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 74, margin: 7 }}>
            {biometricOn && (
              <Pressable onPress={tryBiometric} style={{ height: 74, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 26 }}>👆</Text>
              </Pressable>
            )}
          </View>
          <Key label="0" value="0" />
          <Key label="⌫" value="del" />
        </View>
      </View>
      <Text style={{ marginTop: 22, fontSize: 12.5, color: C.inkFaint, textAlign: 'center', lineHeight: 18 }}>
        Your data never leaves this phone. The PIN only guards the app on this device.
      </Text>
    </View>
  );
}
