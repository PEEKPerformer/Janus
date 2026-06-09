/**
 * Janus design system. A small, deliberate set of tokens (color, spacing,
 * radius, type) with light + dark palettes resolved from the OS color scheme.
 * Per-source accents (Reddit orange, Lemmy green) and their darker *Active
 * variants (for white-on-tint contrast) sit alongside the neutral Janus indigo.
 * `depthRails` is a dedicated low-chroma ramp for comment nesting so structural
 * rails never borrow the vote/source semantic colors.
 */
import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

export interface Palette {
  bg: string;
  bgElevated: string;
  card: string;
  cardPressed: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentActive: string;
  upvote: string;
  downvote: string;
  reddit: string;
  redditActive: string;
  lemmy: string;
  lemmyActive: string;
  danger: string;
  overlay: string;
  skeleton: string;
  /** Neutral, low-chroma ramp for comment nesting rails (cycled by depth). */
  depthRails: string[];
}

const dark: Palette = {
  bg: "#0b0b0f",
  bgElevated: "#1c1c26",
  card: "#181822",
  cardPressed: "#232330",
  border: "#30303c",
  text: "#f4f4f6",
  textSecondary: "#b3b3c0",
  textTertiary: "#9a9aa8",
  accent: "#8b7cff",
  accentActive: "#5a48d6",
  upvote: "#ff6a3d",
  downvote: "#6a8bff",
  reddit: "#ff4500",
  redditActive: "#cc3700",
  lemmy: "#00bc8c",
  lemmyActive: "#00795c",
  danger: "#ff6b6b",
  overlay: "rgba(0,0,0,0.6)",
  skeleton: "#232330",
  depthRails: ["#3a3a48", "#46465a", "#52526a", "#5d5d78"],
};

const light: Palette = {
  bg: "#f6f6f8",
  bgElevated: "#ffffff",
  card: "#ffffff",
  cardPressed: "#ececf1",
  border: "#dcdce4",
  text: "#16161a",
  textSecondary: "#51515e",
  textTertiary: "#6c6c78",
  accent: "#6c5ce7",
  accentActive: "#5a48d6",
  upvote: "#ff4500",
  downvote: "#3d6aff",
  reddit: "#ff4500",
  redditActive: "#cc3700",
  lemmy: "#00a37a",
  lemmyActive: "#00795c",
  danger: "#d62f2f",
  overlay: "rgba(0,0,0,0.4)",
  skeleton: "#e7e7ee",
  depthRails: ["#cfcfdc", "#c2c2d2", "#b5b5c8", "#a8a8be"],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

const baseType = {
  title: {
    fontSize: 17,
    fontWeight: "700" as const,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 21 },
  meta: { fontSize: 13, fontWeight: "500" as const, lineHeight: 17 },
  small: { fontSize: 12, fontWeight: "500" as const, lineHeight: 16 },
};
export const type = baseType;

type TypeScale = typeof baseType;

/** Multiply every text style's fontSize + lineHeight by the user's font scale. */
function scaleType(scale: number): TypeScale {
  if (scale === 1) return baseType;
  const s = <T extends { fontSize: number; lineHeight: number }>(v: T): T => ({
    ...v,
    fontSize: Math.round(v.fontSize * scale),
    lineHeight: Math.round(v.lineHeight * scale),
  });
  return {
    title: s(baseType.title),
    body: s(baseType.body),
    meta: s(baseType.meta),
    small: s(baseType.small),
  };
}

export interface Theme {
  scheme: "light" | "dark";
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  type: TypeScale;
}

/** Normalize a user-entered accent to "#rrggbb", or undefined if invalid. */
export function clampHex(h?: string): string | undefined {
  if (!h) return undefined;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(h.trim());
  return m ? `#${m[1].toLowerCase()}` : undefined;
}

/** Darken a #rrggbb color by a fraction (0..1) — used for the *Active accent. */
export function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 - amount))));
  const v = (ch(16) << 16) + (ch(8) << 8) + ch(0);
  return `#${v.toString(16).padStart(6, "0")}`;
}

/** Layer the user's custom accent + OLED-black choices onto a base palette. */
export function applyOverrides(
  base: Palette,
  scheme: "light" | "dark",
  accent?: string,
  oledBlack?: boolean,
): Palette {
  let out = base;
  const a = clampHex(accent);
  if (a) {
    out = {
      ...out,
      accent: a,
      accentActive: darken(a, scheme === "dark" ? 0.18 : 0.12),
    };
  }
  if (oledBlack && scheme === "dark") {
    out = {
      ...out,
      bg: "#000000",
      card: "#0a0a0e",
      cardPressed: "#16161e",
      bgElevated: "#101016",
      skeleton: "#15151c",
    };
  }
  return out;
}

function buildTheme(
  scheme: "light" | "dark",
  fontScale: number,
  accent?: string,
  oledBlack?: boolean,
): Theme {
  const base = scheme === "light" ? light : dark;
  return {
    scheme,
    colors: applyOverrides(base, scheme, accent, oledBlack),
    spacing,
    radius,
    type: scaleType(fontScale),
  };
}

export type Appearance = "system" | "light" | "dark";

const ThemeContext = createContext<Theme | null>(null);

/**
 * Wraps the app so the user's appearance ("system" follows the OS, else forced)
 * and font scale flow to every {@link useTheme} caller. Components rendered
 * outside a provider (most unit tests) transparently fall back to the OS scheme
 * at scale 1, so existing tests keep working untouched.
 */
export function ThemeProvider({
  appearance,
  fontScale,
  accent,
  oledBlack,
  children,
}: {
  appearance: Appearance;
  fontScale: number;
  /** Custom accent hex ("" / invalid → the default Janus indigo). */
  accent?: string;
  /** True-black backgrounds in dark mode (OLED). */
  oledBlack?: boolean;
  children: React.ReactNode;
}) {
  const system = useColorScheme() === "light" ? "light" : "dark";
  const scheme = appearance === "system" ? system : appearance;
  const theme = useMemo(
    () => buildTheme(scheme, fontScale, accent, oledBlack),
    [scheme, fontScale, accent, oledBlack],
  );
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  // Hook order must be stable, so always read the system scheme; only use it
  // when no provider is present (tests, isolated component renders).
  const system = useColorScheme() === "light" ? "light" : "dark";
  if (ctx) return ctx;
  return buildTheme(system, 1);
}

export const palettes = { dark, light };
