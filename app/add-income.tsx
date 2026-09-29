import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Chip, Field, PrimaryButton } from '../components/ui';
import { addIncome, INCOME_SOURCES } from '../lib/db';
import { parseAmount, todayISO } from '../lib/format';

export default function AddIncome() {
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('Pocket Money');
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
      await addIncome(source, n, note.trim(), todayISO());
      router.back();
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 }]}>
        <Text style={s.h1}>Add Pocket Money</Text>
        <Text style={s.sub}>Record money you received so your balance stays honest.</Text>

        <View style={{ marginTop: 18 }}>
          <Field
            label="Amount (Rs)"
            value={amount}
            onChangeText={(t) => {
              setAmount(t);
              setError('');
            }}
            placeholder="e.g. 5000"
            keyboardType="decimal-pad"
          />
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.inkSoft, marginBottom: 8 }}>Source</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {INCOME_SOURCES.map((src) => (
              <Chip key={src} label={src} selected={source === src} onPress={() => setSource(src)} />
            ))}
          </View>
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Monthly allowance" />
          {error ? <Text style={{ color: C.red, fontSize: 13.5, fontWeight: '600', marginBottom: 10 }}>{error}</Text> : null}
          <PrimaryButton title={saving ? 'Saving…' : 'Save Pocket Money'} onPress={save} disabled={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
