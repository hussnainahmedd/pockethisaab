import { StyleSheet } from 'react-native';

/* ------------------------------------------------------------------ */
/* Pocket Pop design system (M5)                                       */
/* Warm paper surfaces, deep green ink, emerald brand, gold coin       */
/* accent. Single source of truth for every screen — see               */
/* docs/V2-M5-DESIGN.md for the research and rationale.                */
/* ------------------------------------------------------------------ */

export const C = {
  // surfaces
  bg: '#F8F5EC',
  card: '#FFFFFF',
  ink: '#101D15',
  inkSoft: '#57655A',
  inkFaint: '#A3AC9D',
  line: '#E8E1CE',

  // brand — emerald family (continuity with v1)
  emerald: '#0E9F6E',
  emeraldDark: '#0A6B45',
  emeraldDeep: '#052E21',
  teal: '#14B8A6',
  lime: '#BEF264',
  limeSoft: '#F3FBD9',

  // gold coin accent (M5)
  gold: '#F2B33D',
  goldDark: '#96690C',
  goldSoft: '#FCEFC7',

  // soft tints
  emeraldSoft: '#DFF5E6',
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
  hero: ['#052E21', '#0A5C40', '#0E9F6E'] as const, // deep ink → emerald
  heroAlt: ['#14B8A6', '#0E9F6E'] as const, // teal → emerald
  limePop: ['#BEF264', '#A3E635'] as const, // lime pop
  money: ['#0E9F6E', '#14B8A6'] as const,
  gold: ['#F6C453', '#F2B33D'] as const, // coin gold
  danger: ['#F43F5E', '#E11D48'] as const,
  violet: ['#8B5CF6', '#6D28D9'] as const,
  card: ['#FFFFFF', '#FBF9F2'] as const,
};

export const R = 22;
export const R_LG = 28;
export const R_SM = 16;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 118 },
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
    shadowColor: '#5C4A12',
    shadowOpacity: 0.08,
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
