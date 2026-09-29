import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, G, R } from './theme';

/* ---------- Card ---------- */
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View
      style={[
        {
          backgroundColor: C.card,
          borderRadius: R,
          padding: 18,
          borderWidth: 1,
          borderColor: C.line,
          shadowColor: '#0E9F6E',
          shadowOpacity: 0.1,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ---------- Gradient hero card (balance / totals) ---------- */
export function HeroCard({
  eyebrow,
  value,
  valueColor = '#fff',
  sub,
  subColor = 'rgba(255,255,255,0.72)',
  colors = G.hero,
  style,
}: {
  eyebrow: string;
  value: string;
  valueColor?: string;
  sub?: string;
  subColor?: string;
  colors?: readonly [string, string, ...string[]];
  style?: object;
}) {
  return (
    <LinearGradient
      colors={colors as unknown as [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          borderRadius: 26,
          padding: 22,
          marginTop: 18,
          shadowColor: '#0E9F6E',
          shadowOpacity: 0.35,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* lime glow blob */}
      <View
        style={{
          position: 'absolute',
          top: -46,
          right: -46,
          width: 150,
          height: 150,
          borderRadius: 75,
          backgroundColor: C.lime,
          opacity: 0.28,
        }}
      />
      <Text style={styles.heroEyebrow}>{eyebrow}</Text>
      <Text style={[styles.heroValue, { color: valueColor }]}>{value}</Text>
      {sub ? <Text style={[styles.heroSub, { color: subColor }]}>{sub}</Text> : null}
    </LinearGradient>
  );
}

/* ---------- Primary button (gradient + glow) ---------- */
export function PrimaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [disabled && { opacity: 0.45 }, pressed && !disabled && { transform: [{ scale: 0.98 }] }]}
    >
      <LinearGradient
        colors={['#0E9F6E', '#14B8A6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.primary}
      >
        <Text style={styles.primaryText}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/* ---------- Danger button ---------- */
export function DangerButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}>
      <LinearGradient colors={['#F43F5E', '#E11D48']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primary}>
        <Text style={styles.primaryText}>{title}</Text>
      </LinearGradient>
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
      <View style={styles.emptyBadge}>
        <Text style={{ fontSize: 40 }}>{emoji}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

/* ---------- Stat tile ---------- */
const TONES = {
  green: { fg: C.emeraldDark, bg: C.emeraldSoft },
  red: { fg: C.redDark, bg: C.redSoft },
  amber: { fg: C.amberDark, bg: C.amberSoft },
  neutral: { fg: C.ink, bg: '#EAF3EE' },
  violet: { fg: '#6D28D9', bg: C.violetSoft },
  sky: { fg: '#0369A1', bg: C.skySoft },
} as const;

export function StatTile({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONES;
  onPress?: () => void;
}) {
  const t = TONES[tone];
  const inner = (
    <View style={[styles.tile, { backgroundColor: t.bg }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color: t.fg }]}>{value}</Text>
      {onPress ? <Text style={[styles.tileHint, { color: t.fg }]}>tap to manage ›</Text> : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.75 : 1 }]}>
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
      style={[styles.chip, selected && { backgroundColor: C.ink, borderColor: C.ink }]}
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
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#0E9F6E',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryText: { color: '#fff', fontSize: 16.5, fontWeight: '800', letterSpacing: 0.2 },
  ghost: {
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  ghostText: { color: C.ink, fontSize: 15, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.ink,
  },
  empty: { alignItems: 'center', paddingVertical: 46, paddingHorizontal: 30 },
  emptyBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.limeSoft,
    borderWidth: 1.5,
    borderColor: '#D9F2A8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#A3E635',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.ink, marginTop: 16, textAlign: 'center', letterSpacing: -0.2 },
  emptyBody: { fontSize: 14, color: C.inkSoft, marginTop: 8, textAlign: 'center', lineHeight: 22 },
  tile: { borderRadius: 20, padding: 15 },
  tileLabel: { fontSize: 12, fontWeight: '700', color: C.inkSoft },
  tileValue: { fontSize: 17, fontWeight: '900', marginTop: 7, fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  tileHint: { fontSize: 11, fontWeight: '700', marginTop: 6, opacity: 0.7 },
  chip: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13.5, fontWeight: '700', color: C.ink },
  heroEyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2, color: C.lime, textTransform: 'uppercase' },
  heroValue: { fontSize: 42, fontWeight: '900', marginTop: 8, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  heroSub: { fontSize: 13, marginTop: 10, lineHeight: 19 },
});
