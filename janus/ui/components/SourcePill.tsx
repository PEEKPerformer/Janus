import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";
import type { SourceKind } from "../../core/ids";

/**
 * Provenance chip — shows which backend (and, for Lemmy, which instance) an
 * item came from. Used wherever cross-account streams are merged (inbox,
 * conversation list) so the user always knows where a message originated.
 */
export function SourcePill({
  source,
  instance,
  size = "sm",
}: {
  source: SourceKind;
  instance: string;
  size?: "sm" | "xs";
}) {
  const t = useTheme();
  const color = source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const label = source === "reddit" ? "reddit" : instance.replace(/^www\./, "");
  const fontSize = size === "xs" ? 9 : 10;
  return (
    <View
      style={[
        styles.pill,
        { borderColor: color, backgroundColor: color + "1A" },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text
        style={[styles.text, { color, fontSize }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 140,
  },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: 4 },
  text: { fontWeight: "700", letterSpacing: 0.2 },
});
