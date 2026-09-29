import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { DangerButton, Field, PrimaryButton } from '../components/ui';
import { deleteUdhaar, getUdhaarById, updateUdhaar, type UdhaarDirection } from '../lib/db';
import { parseAmount } from '../lib/format';

function isValidDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export default function EditUdhaar() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const entryId = Number(id);
  const [loaded, setLoaded] = useState(false);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<UdhaarDirection>('lent');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const e = await getUdhaarById(entryId);
      if (!e) {
        setError('Entry not found.');
        setLoaded(true);
        return;
      }
      setPerson(e.person);
      setAmount(String(e.amount));
      setDirection(e.direction);
      setNote(e.note ?? '');
      setDate(e.date);
      setLoaded(true);
    })();
  }, [entryId]);

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
    if (!isValidDate(date.trim())) {
      setError('Date must look like 2026-09-29.');
      return;
    }
    setSaving(true);
    try {
      await updateUdhaar(entryId, person, n, direction, note.trim(), date.trim());
      router.back();
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  const askDelete = () => {
    Alert.alert('Delete udhaar entry?', 'This entry will be removed permanently and balances will update.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteUdhaar(entryId);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 }]}>
        <Text style={s.eyebrow}>fix it up ✦</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>Edit Udhaar</Text>
        <Text style={s.sub}>Fix the name, amount or direction — every balance updates instantly.</Text>

        {!loaded ? (
          <Text style={[s.sub, { marginTop: 18 }]}>Loading…</Text>
        ) : (
          <View style={{ marginTop: 18 }}>
            <Field
              label="Person's name"
              value={person}
              onChangeText={(t) => {
                setPerson(t);
                setError('');
              }}
              placeholder="e.g. Bilal"
              autoCapitalize="words"
            />

            <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 8 }}>Direction</Text>
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
            <Field
              label="Date (YYYY-MM-DD)"
              value={date}
              onChangeText={(t) => {
                setDate(t);
                setError('');
              }}
              placeholder="2026-09-29"
              autoCapitalize="none"
            />
            {error ? <Text style={{ color: C.redDark, fontSize: 13.5, fontWeight: '700', marginBottom: 10 }}>{error}</Text> : null}
            <PrimaryButton title={saving ? 'Saving…' : 'Save Changes'} onPress={save} disabled={saving} />
            <View style={{ marginTop: 10 }}>
              <DangerButton title="Delete Entry" onPress={askDelete} />
            </View>
          </View>
        )}
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
          borderRadius: 18,
          borderWidth: 2,
          borderColor: selected ? C.emerald : C.line,
          backgroundColor: selected ? C.emeraldSoft : '#fff',
          padding: 15,
        },
      ]}
    >
      <Text style={{ fontSize: 15, fontWeight: '800', color: selected ? C.emeraldDark : C.ink }}>{label}</Text>
      <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 4 }}>{hint}</Text>
    </Pressable>
  );
}
