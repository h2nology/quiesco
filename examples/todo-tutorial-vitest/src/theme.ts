/**
 * Design tokens from the Quiesco design system (DESIGN.md at the repository root): ink and paper neutrals,
 * Klein blue for the one primary action, Geist type, small radii, flat surfaces separated by 1px lines, and
 * the round dot as the only fully round shape. Every screen reads colors from here.
 */
import { Platform, useColorScheme } from 'react-native';

const light = {
  canvas: '#f5f6f8',
  surface: '#ffffff',
  surfaceSunken: '#f0f2f5',
  line: '#e3e6ec',
  ink: '#0c0f1a',
  inkMuted: '#555c6e',
  /** Klein: the primary action, links, selection, the open state. */
  primary: '#002fa7',
  primaryPressed: '#00258a',
  onPrimary: '#ffffff',
  /** The logo dot and focus rings; never text on light backgrounds. */
  signal: '#6f86ff',
  accentSoft: '#e7ecff',
  /** Links, the header's back button, and text on the accent soft background: Klein light, Signal dark. */
  accentText: '#002fa7',
  danger: '#c0262d',
  dangerSoft: '#fbe8e8',
};

const dark: typeof light = {
  canvas: '#090b12',
  surface: '#10131c',
  surfaceSunken: '#0b0e15',
  line: '#232838',
  ink: '#eef0f5',
  inkMuted: '#9aa1b2',
  primary: '#4a66f0',
  primaryPressed: '#4560ec',
  onPrimary: '#ffffff',
  signal: '#6f86ff',
  accentSoft: '#18204a',
  accentText: '#6f86ff',
  danger: '#ff7a7a',
  dangerSoft: '#361518',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 4 px base unit. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
/** Squared, with one circle: radii never exceed 12 on rectangles; `full` only for dots and pills. */
export const radius = { xs: 4, sm: 6, md: 8, lg: 12, full: 9999 } as const;

/** Geist, loaded in src/app/_layout.tsx. */
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
} as const;

const tabular = { fontVariant: ['tabular-nums' as const] };

export const type = {
  headline: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.7 },
  section: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, letterSpacing: -0.15 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  labelSm: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 16, letterSpacing: 0.13, ...tabular },
} as const;

/**
 * Control height. DESIGN.md's 36 px is for pointer-driven tool screens; a phone app keeps the 44 pt (iOS) /
 * 48 dp (Android) touch minimum, so controls are 48 tall here.
 */
export const control = 48;
/** The rest of the touch target around smaller visuals (checkbox, icons). */
export const touchTarget = 48;
/** Readable content width on tablets and desktop browsers. */
export const maxContentWidth = 560;

/** Web: whether the last input was the keyboard, so a click does not leave a focus ring behind. */
let keyboardInput = false;
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener('keydown', () => (keyboardInput = true), true);
  document.addEventListener('pointerdown', () => (keyboardInput = false), true);
}

/** The 2 px Signal focus ring, offset by 2 px: keyboard focus on the web only. */
export function focusRing(c: Colors, focused: boolean): object | undefined {
  if (Platform.OS !== 'web' || !focused || !keyboardInput) return undefined;
  return { outlineStyle: 'solid', outlineWidth: 2, outlineColor: c.signal, outlineOffset: 2 };
}

/** react-native-web passes `hovered` and `focused` to a Pressable's style function besides `pressed`. */
export interface InteractionState {
  pressed: boolean;
  hovered?: boolean;
  focused?: boolean;
}
