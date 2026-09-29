import { StyleSheet } from 'react-native';

/* ------------------------------------------------------------------ */
/* Gen Z fintech palette                                               */
/* ------------------------------------------------------------------ */

export const C = {
  // surfaces
  bg: '#EFF7F2',
  card: '#FFFFFF',
  ink: '#0A1F16',
  inkSoft: '#4E625A',
  inkFaint: '#93A8A0',
  line: '#DCE9E1',

  // brand — emerald → teal → lime
  emerald: '#0E9F6E',
  emeraldDark: '#0B6E4E',
  emeraldDeep: '#07352A',
  teal: '#14B8A6',
  lime: '#BEF264',
  limeSoft: '#F0FBD8',

  // soft tints
  emeraldSoft: '#DDF5E7',
  red: '#F43F5E',
  redDark: '#BE123C',
  redSoft: '#FFE4E9',
  amber: '#F59E0B',
  amberDark: '#B45309',
  amberSoft: '#FEF3D8',
  navy: '#0B3B2E',
  violet: '#8B5CF6',
  violetSoft: '#EDE9FE',
  sky: '#0EA5E9',
  skySoft: '#E0F2FE',
};

/* Gradient stops used across the app */
export const G = {
  hero: ['#0E9F6E', '#0D9488', '#0B3B2E'] as const, // emerald → teal → deep
  heroAlt: ['#14B8A6', '#0E9F6E'] as const, // teal → emerald
  limePop: ['#BEF264', '#A3E635'] as const, // lime pop
  money: ['#0E9F6E', '#14B8A6'] as const,
  danger: ['#F43F5E', '#E11D48'] as const,
  violet: ['#8B5CF6', '#6D28D9'] as const,
  card: ['#FFFFFF', '#F4FAF6'] as const,
};

export const R = 22;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 110 },
  h1: { fontSize: 30, fontWeight: '900', color: C.ink, letterSpacing: -0.8 },
  h2: { fontSize: 19, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  sub: { fontSize: 14, color: C.inkSoft, marginTop: 5, lineHeight: 21 },
  eyebrow: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: C.emeraldDark,
    textTransform: 'uppercase',
  },
  card: {
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
  row: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: C.ink, marginTop: 24, marginBottom: 12, letterSpacing: -0.2 },
  money: { fontVariant: ['tabular-nums'] },
  glow: {
    shadowColor: '#0E9F6E',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
