import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../components/theme';
import { Card, Chip, Field, GhostButton, PrimaryButton } from '../components/ui';
import { getLedger } from '../lib/finance/appLedger';
import type { Category } from '../lib/finance/types';

export default function CategoriesScreen() {
  const ledger = getLedger();
  const [categories, setCategories] = useState<Category[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');

  const load = useCallback(async () => {
    setCategories(await ledger.listCategories({ includeArchived: true }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const add = async () => {
    if (!name.trim()) return Alert.alert('Name needed', 'Give the category a name.');
    try {
      await ledger.createCategory({ name: name.trim(), kind, icon: icon.trim() || null });
      setName('');
      setIcon('');
      load();
    } catch (e) {
      Alert.alert('Could not add category', e instanceof Error ? e.message : String(e));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await ledger.updateCategory(editing.id, { name: editName.trim(), icon: editIcon.trim() || null });
      setEditing(null);
      load();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  const actions = (c: Category) => {
    Alert.alert(c.name, c.system ? 'Built-in category' : 'Custom category', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Edit',
        onPress: () => {
          setEditing(c);
          setEditName(c.name);
          setEditIcon(c.icon ?? '');
        },
      },
      {
        text: c.archived ? 'Restore' : 'Archive',
        onPress: async () => {
          await ledger.setCategoryArchived(c.id, !c.archived);
          load();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await ledger.deleteCategory(c.id);
            load();
          } catch (e) {
            Alert.alert('Cannot delete', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  const section = (title: string, kind: 'expense' | 'income') => {
    const list = categories.filter((c) => c.kind === kind && (showArchived || !c.archived));
    return (
      <>
        <Text style={s.sectionTitle}>{title}</Text>
        {list.length === 0 ? (
          <Card>
            <Text style={{ color: C.inkSoft }}>No {kind} categories.</Text>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {list.map((c, i) => (
              <View key={c.id} style={[s.row, { paddingVertical: 12, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: C.line, opacity: c.archived ? 0.55 : 1 }]}>
                <Text style={{ fontSize: 19, marginRight: 12 }}>{c.icon ?? '🏷️'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{c.name}</Text>
                  <Text style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>
                    {c.system ? 'Built-in' : 'Custom'}
                    {c.archived ? ' · archived' : ''}
                  </Text>
                </View>
                <GhostButton title="Manage" onPress={() => actions(c)} />
              </View>
            ))}
          </Card>
        )}
      </>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.h1}>Categories</Text>
        <Text style={s.sub}>Organize income and expenses your way. Built-in categories can be archived but not deleted.</Text>
        {section('Expense categories', 'expense')}
        {section('Income categories', 'income')}

        {editing ? (
          <Card style={{ marginTop: 18 }}>
            <Text style={s.h2}>Edit category</Text>
            <View style={{ height: 12 }} />
            <Field label="Name" value={editName} onChangeText={setEditName} />
            <Field label="Icon (emoji)" value={editIcon} onChangeText={setEditIcon} placeholder="🏷️" />
            <PrimaryButton title="Save" onPress={saveEdit} />
            <View style={{ height: 10 }} />
            <GhostButton title="Cancel" onPress={() => setEditing(null)} />
          </Card>
        ) : (
          <Card style={{ marginTop: 18 }}>
            <Text style={s.h2}>Add category</Text>
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
              <Chip label="Expense" selected={kind === 'expense'} onPress={() => setKind('expense')} />
              <Chip label="Income" selected={kind === 'income'} onPress={() => setKind('income')} />
            </View>
            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. University, Freelance" />
            <Field label="Icon (emoji, optional)" value={icon} onChangeText={setIcon} placeholder="🎓" />
            <PrimaryButton title="Add category" onPress={add} />
          </Card>
        )}

        {categories.some((c) => c.archived) && (
          <View style={{ marginTop: 14 }}>
            <GhostButton title={showArchived ? 'Hide archived' : 'Show archived categories'} onPress={() => setShowArchived(!showArchived)} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
