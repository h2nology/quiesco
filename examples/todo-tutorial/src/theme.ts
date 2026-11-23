/**
 * Design tokens (Minimalism / Swiss style: teal primary, generous white space, one sans-serif family).
 * Every screen reads colors from here; nothing hardcodes a hex value.
 */
import { useColorScheme } from 'react-native';

const light = {
  background: '#F0FDFA',
  surface: '#FFFFFF',
  surfacePressed: '#E6F4F1',
  text: '#134E4A',
  textMuted: '#475569',
  border: '#CCE7E2',
  primary: '#0F766E', // white text on it: 5.5:1
  primaryPressed: '#115E59',
  onPrimary: '#FFFFFF',
  primarySoft: '#CCFBF1',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  inputBackground: '#FFFFFF',
};

const dark: typeof light = {
  background: '#0B1F1E',
  surface: '#12302E',
  surfacePressed: '#1A3D3A',
  text: '#E6FFFA',
  textMuted: '#A7B8C4',
  border: '#2A4B48',
  primary: '#2DD4BF',
  primaryPressed: '#5EEAD4',
  onPrimary: '#042F2E',
  primarySoft: '#134E4A',
  danger: '#FCA5A5',
  dangerSoft: '#451A1A',
  inputBackground: '#0F2826',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 4 / 8 pt rhythm. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, pill: 999 } as const;
export const font = {
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
} as const;
/** Minimum touch target (iOS 44 pt, Android 48 dp): the larger one everywhere. */
export const touchTarget = 48;
/** Readable content width on tablets and desktop browsers. */
export const maxContentWidth = 560;
