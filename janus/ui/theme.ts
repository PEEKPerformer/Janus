/**
 * Janus design system. A small, deliberate set of tokens (color, spacing,
 * radius, type) with light + dark palettes resolved from the OS color scheme.
 * Per-source accents (Reddit orange, Lemmy green) live alongside the neutral
 * Janus indigo so the UI can signal "which world am I in" without shouting.
 */
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
  upvote: string;
  downvote: string;
  reddit: string;
  lemmy: string;
  danger: string;
  overlay: string;
  skeleton: string;
}

const dark: Palette = {
  bg: "#0b0b0f",
  bgElevated: "#15151c",
  card: "#15151c",
  cardPressed: "#1f1f29",
  border: "#26262f",
  text: "#f4f4f6",
  textSecondary: "#a9a9b6",
  textTertiary: "#6d6d7a",
  accent: "#8b7cff",
  upvote: "#ff6a3d",
  downvote: "#6a8bff",
  reddit: "#ff4500",
  lemmy: "#00bc8c",
  danger: "#ff5d5d",
  overlay: "rgba(0,0,0,0.6)",
  skeleton: "#1c1c25",
};

const light: Palette = {
  bg: "#f6f6f8",
  bgElevated: "#ffffff",
  card: "#ffffff",
  cardPressed: "#ececf1",
  border: "#e2e2e8",
  text: "#16161a",
  textSecondary: "#5b5b68",
  textTertiary: "#8a8a96",
  accent: "#6c5ce7",
  upvote: "#ff4500",
  downvote: "#3d6aff",
  reddit: "#ff4500",
  lemmy: "#00a37a",
  danger: "#d62f2f",
  overlay: "rgba(0,0,0,0.4)",
  skeleton: "#e7e7ee",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const type = {
  title: { fontSize: 17, fontWeight: "700" as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 21 },
  meta: { fontSize: 13, fontWeight: "500" as const, lineHeight: 17 },
  small: { fontSize: 12, fontWeight: "500" as const, lineHeight: 16 },
};

export interface Theme {
  scheme: "light" | "dark";
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
}

export function useTheme(): Theme {
  const scheme: "light" | "dark" = useColorScheme() === "light" ? "light" : "dark";
  return {
    scheme,
    colors: scheme === "light" ? light : dark,
    spacing,
    radius,
    type,
  };
}

export const palettes = { dark, light };
