import { StyleSheet } from 'react-native';

export const C = {
  bg: '#F4F7F6',
  card: '#FFFFFF',
  ink: '#0F1E1B',
  inkSoft: '#5B6B67',
  inkFaint: '#8FA19C',
  line: '#E4ECEA',
  emerald: '#0E9F6E',
  emeraldDark: '#0B7A55',
  emeraldSoft: '#E3F5EC',
  red: '#E5484D',
  redSoft: '#FDECEC',
  amber: '#D97706',
  amberSoft: '#FEF3E2',
  navy: '#123B33',
};

export const R = 16;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 110 },
  h1: { fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  sub: { fontSize: 13.5, color: C.inkSoft, marginTop: 4, lineHeight: 20 },
  card: {
    backgroundColor: C.card,
    borderRadius: R,
    padding: 16,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: '#0F1E1B',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink, marginTop: 22, marginBottom: 10 },
  money: { fontVariant: ['tabular-nums'] },
});
