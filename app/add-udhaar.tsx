import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Field, PrimaryButton } from '../components/ui';
import { addUdhaar, type UdhaarDirection } from '../lib/db';
import { parseAmount, todayISO } from '../lib/format';

export default function AddUdhaar() {
  const params = useLocalSearchParams<{ person?: string }>();
  const [person, setPerson] = useState(typeof params.person === 'string' ? params.person : '');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<UdhaarDirection>('lent');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!person.trim()) {
      setError('Enter the person\u2019s name.');
      return;
    }
    const n = parseAmount(amount);
    if (n === null) {
      setError('Enter a valid amount (more than 0).');
      return;
    }
    setSaving(true);
    try {
      await addUdhaar(person, n, direction, note.trim(), todayISO());
      router.back();
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 }]}>
        <Text style={s.h1}>New Udhaar Entry</Text>
        <Text style={s.sub}>Write it down now — memory fades, ledgers don’t.</Text>

        <View style={{ marginTop: 18 }}>
          <Field
            label="Person's name"
            value={person}
            onChangeText={(t) => {
              setPerson(t);
              setError('');
            }}
            placeholder="e.g. Ahmed"
            autoCapitalize="words"
          />

          <Text style={{ fontSize: 13, fontWeight: '600', color: C.inkSoft, marginBottom: 8 }}>Direction</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <DirectionCard
              label="I lent them"
              hint="They owe me"
              selected={direction === 'lent'}
              onPress={() => setDirection('lent')}
            />
            <DirectionCard
              label="I borrowed"
              hint="I owe them"
              selected={direction === 'borrowed'}
              onPress={() => setDirection('borrowed')}
            />
          </View>

          <Field
            label="Amount (Rs)"
            value={amount}
            onChangeText={(t) => {
              setAmount(t);
              setError('');
            }}
            placeholder="e.g. 1000"
            keyboardType="decimal-pad"
          />
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. For lunch" />
          {error ? <Text style={{ color: C.red, fontSize: 13.5, fontWeight: '600', marginBottom: 10 }}>{error}</Text> : null}
          <PrimaryButton title={saving ? 'Saving…' : 'Save Entry'} onPress={save} disabled={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DirectionCard({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          flex: 1,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: selected ? C.emerald : C.line,
          backgroundColor: selected ? C.emeraldSoft : '#fff',
          padding: 14,
        },
      ]}
    >
      <Text style={{ fontSize: 15, fontWeight: '800', color: selected ? C.emeraldDark : C.ink }}>{label}</Text>
      <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 4 }}>{hint}</Text>
    </Pressable>
  );
}
