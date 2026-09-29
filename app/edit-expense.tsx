import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Chip, DangerButton, Field, PrimaryButton } from '../components/ui';
import { CATEGORIES, deleteExpense, getExpenseById, updateExpense } from '../lib/db';
import { parseAmount } from '../lib/format';

function isValidDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export default function EditExpense() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const entryId = Number(id);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('food');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const e = await getExpenseById(entryId);
      if (!e) {
        setError('Entry not found.');
        setLoaded(true);
        return;
      }
      setAmount(String(e.amount));
      setCategory(e.category);
      setNote(e.note ?? '');
      setDate(e.date);
      setLoaded(true);
    })();
  }, [entryId]);

  const save = async () => {
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
      await updateExpense(entryId, n, category, note.trim(), date.trim());
      router.back();
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  const askDelete = () => {
    Alert.alert('Delete expense?', 'This entry will be removed permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(entryId);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 }]}>
        <Text style={s.eyebrow}>fix it up ✦</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>Edit Expense</Text>
        <Text style={s.sub}>Mis-typed something? Fix it here — your totals update instantly.</Text>

        {!loaded ? (
          <Text style={[s.sub, { marginTop: 18 }]}>Loading…</Text>
        ) : (
          <View style={{ marginTop: 18 }}>
            <Field
              label="Amount (Rs)"
              value={amount}
              onChangeText={(t) => {
                setAmount(t);
                setError('');
              }}
              placeholder="e.g. 250"
              keyboardType="decimal-pad"
            />
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 8 }}>Category</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
              {CATEGORIES.map((c) => (
                <Chip key={c.key} label={c.label} emoji={c.emoji} selected={category === c.key} onPress={() => setCategory(c.key)} />
              ))}
            </View>
            <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Biryani with friends" />
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
