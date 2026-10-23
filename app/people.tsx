import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, EmptyState, Field, GhostButton, PrimaryButton } from '../components/ui';
import { getLedger } from '../lib/finance/appLedger';
import { formatMinor } from '../lib/finance/money';
import type { Person } from '../lib/finance/types';

interface Row {
  person: Person;
  lentMinor: number;
  borrowedMinor: number;
  openCount: number;
}

export default function PeopleScreen() {
  const ledger = getLedger();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState<Person | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const load = useCallback(async () => {
    const [people, summaries] = await Promise.all([
      ledger.listPeople({ includeArchived: true }),
      ledger.getPersonSummaries(),
    ]);
    const byId = new Map(summaries.map((x) => [x.person.id, x]));
    setRows(
      people.map((p) => ({
        person: p,
        lentMinor: byId.get(p.id)?.lentMinor ?? 0,
        borrowedMinor: byId.get(p.id)?.borrowedMinor ?? 0,
        openCount: byId.get(p.id)?.openCount ?? 0,
      })),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) => (showArchived || !r.person.archived) && (!q || r.person.name.toLowerCase().includes(q)),
  );

  const add = async () => {
    if (!name.trim()) return Alert.alert('Name needed', 'Enter the person’s name.');
    try {
      await ledger.findOrCreatePerson(name.trim(), phone.trim() || null);
      setName('');
      setPhone('');
      load();
    } catch (e) {
      Alert.alert('Could not add person', e instanceof Error ? e.message : String(e));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await ledger.updatePerson(editing.id, { name: editName.trim(), phone: editPhone.trim() || null });
      setEditing(null);
      load();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  const actions = (row: Row) => {
    const p = row.person;
    Alert.alert(p.name, 'What do you want to do?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open ledger', onPress: () => router.push({ pathname: '/person/[name]', params: { name: p.name } }) },
      {
        text: 'Edit',
        onPress: () => {
          setEditing(p);
          setEditName(p.name);
          setEditPhone(p.phone ?? '');
        },
      },
      {
        text: p.archived ? 'Restore' : 'Archive',
        onPress: async () => {
          await ledger.setPersonArchived(p.id, !p.archived);
          load();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await ledger.deletePerson(p.id);
            load();
          } catch (e) {
            Alert.alert('Cannot delete', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>People</Text>
        <Text style={s.sub}>Everyone you have udhaar with. Creating a person never asks for contacts permission.</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search people…"
          placeholderTextColor={C.inkFaint}
          style={{
            backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.line, borderRadius: 16,
            paddingHorizontal: 16, paddingVertical: 13, fontSize: 15.5, color: C.ink, marginTop: 14,
          }}
        />
        <View style={{ height: 14 }} />
        {visible.length === 0 ? (
          <Card>
            <EmptyState emoji="👥" title="No people found" body="Add someone below, or record an udhaar with them." />
          </Card>
        ) : (
          visible.map((r) => {
            const net = r.lentMinor - r.borrowedMinor;
            return (
              <Card key={r.person.id} style={{ marginBottom: 12, opacity: r.person.archived ? 0.6 : 1 }}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink }}>
                      {r.person.name}
                      {r.person.archived ? ' · archived' : ''}
                    </Text>
                    <Text style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 3 }}>
                      {r.openCount > 0
                        ? net > 0
                          ? `Owes you ${formatMinor(net)} across ${r.openCount} open loan${r.openCount === 1 ? '' : 's'}`
                          : net < 0
                            ? `You owe ${formatMinor(-net)} across ${r.openCount} open loan${r.openCount === 1 ? '' : 's'}`
                            : `${r.openCount} open loans, net settled`
                        : 'No open udhaar'}
                      {r.person.phone ? ` · ${r.person.phone}` : ''}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <GhostButton title="Open" onPress={() => router.push({ pathname: '/person/[name]', params: { name: r.person.name } })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GhostButton title="Manage" onPress={() => actions(r)} />
                  </View>
                </View>
              </Card>
            );
          })
        )}

        {editing ? (
          <Card style={{ marginTop: 6 }}>
            <Text style={s.h2}>Edit person</Text>
            <View style={{ height: 12 }} />
            <Field label="Name" value={editName} onChangeText={setEditName} autoCapitalize="words" />
            <Field label="Phone (optional)" value={editPhone} onChangeText={setEditPhone} keyboardType="numeric" />
            <PrimaryButton title="Save" onPress={saveEdit} />
            <View style={{ height: 10 }} />
            <GhostButton title="Cancel" onPress={() => setEditing(null)} />
          </Card>
        ) : (
          <Card style={{ marginTop: 6 }}>
            <Text style={s.h2}>Add person</Text>
            <View style={{ height: 12 }} />
            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Ahmed Raza" autoCapitalize="words" />
            <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="03xx xxxxxxx" keyboardType="numeric" />
            <PrimaryButton title="Add person" onPress={add} />
          </Card>
        )}

        {rows.some((r) => r.person.archived) && (
          <View style={{ marginTop: 14 }}>
            <GhostButton title={showArchived ? 'Hide archived' : 'Show archived people'} onPress={() => setShowArchived(!showArchived)} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
