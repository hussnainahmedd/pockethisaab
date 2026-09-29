import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Chip, Field, PrimaryButton } from '../components/ui';
import { addExpense, CATEGORIES } from '../lib/db';
import { parseAmount, todayISO } from '../lib/format';

export default function AddExpense() {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('food');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const n = parseAmount(amount);
    if (n === null) {
      setError('Enter a valid amount (more than 0).');
      return;
    }
    setSaving(true);
    try {
      await addExpense(n, category, note.trim(), todayISO());
      router.back();
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 }]}>
        <Text style={s.h1}>Add Expense</Text>
        <Text style={s.sub}>Log what you spent, right when you spend it.</Text>

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
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.inkSoft, marginBottom: 8 }}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {CATEGORIES.map((c) => (
              <Chip key={c.key} label={c.label} emoji={c.emoji} selected={category === c.key} onPress={() => setCategory(c.key)} />
            ))}
          </View>
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Biryani with friends" />
          {error ? <Text style={{ color: C.red, fontSize: 13.5, fontWeight: '600', marginBottom: 10 }}>{error}</Text> : null}
          <PrimaryButton title={saving ? 'Saving…' : 'Save Expense'} onPress={save} disabled={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
