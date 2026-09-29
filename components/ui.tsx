import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from './theme';

/* ---------- Card ---------- */
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[{ backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.line, shadowColor: '#0F1E1B', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, style]}>{children}</View>;
}

/* ---------- Primary button ---------- */
export function PrimaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primary,
        disabled && { opacity: 0.45 },
        pressed && !disabled && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={styles.primaryText}>{title}</Text>
    </Pressable>
  );
}

/* ---------- Ghost / secondary button ---------- */
export function GhostButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}>
      <Text style={styles.ghostText}>{title}</Text>
    </Pressable>
  );
}

/* ---------- Labeled text input ---------- */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.inkFaint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
      />
    </View>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 44 }}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

/* ---------- Stat tile ---------- */
export function StatTile({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  tone: 'green' | 'red' | 'amber' | 'neutral';
  onPress?: () => void;
}) {
  const toneColor = tone === 'green' ? C.emeraldDark : tone === 'red' ? C.red : tone === 'amber' ? C.amber : C.ink;
  const chipBg = tone === 'green' ? C.emeraldSoft : tone === 'red' ? C.redSoft : tone === 'amber' ? C.amberSoft : C.bg;
  const inner = (
    <View style={[styles.tile, { backgroundColor: chipBg }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color: toneColor, fontVariant: ['tabular-nums'] }]}>{value}</Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={{ flex: 1 }}>
        {inner}
      </Pressable>
    );
  }
  return <View style={{ flex: 1 }}>{inner}</View>;
}

/* ---------- Chip (selectable) ---------- */
export function Chip({
  label,
  emoji,
  selected,
  onPress,
}: {
  label: string;
  emoji?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: C.navy, borderColor: C.navy }]}
    >
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>
        {emoji ? `${emoji} ` : ''}
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: C.emerald,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghost: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  ghostText: { color: C.ink, fontSize: 15, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: C.inkSoft, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: C.ink,
  },
  empty: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 12, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: C.inkSoft, marginTop: 6, textAlign: 'center', lineHeight: 21 },
  tile: { borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 12, fontWeight: '600', color: C.inkSoft },
  tileValue: { fontSize: 16.5, fontWeight: '800', marginTop: 6 },
  chip: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13.5, fontWeight: '600', color: C.ink },
});
