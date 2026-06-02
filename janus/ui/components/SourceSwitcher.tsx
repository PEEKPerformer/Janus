import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import type { SourceKind } from "../../core/ids";

const OPTIONS: { key: SourceKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "reddit", label: "Reddit", icon: "logo-reddit" },
  { key: "lemmy", label: "Lemmy", icon: "planet" },
];

export function SourceSwitcher() {
  const t = useTheme();
  const { activeSource, setActiveSource } = useAdapters();
  return (
    <View
      style={[styles.wrap, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.pill }]}
      accessibilityRole="tablist"
    >
      {OPTIONS.map((o) => {
        const active = o.key === activeSource;
        // Darker *Active tints so white label/icon clears WCAG AA contrast.
        const tint = o.key === "reddit" ? t.colors.redditActive : t.colors.lemmyActive;
        return (
          <Pressable
            key={o.key}
            onPress={() => setActiveSource(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Show ${o.label}`}
            style={[styles.tab, { borderRadius: t.radius.pill }, active && { backgroundColor: tint }]}
          >
            <Ionicons name={o.icon} size={15} color={active ? "#fff" : t.colors.textSecondary} />
            <Text style={[t.type.meta, { marginLeft: 6, color: active ? "#fff" : t.colors.textSecondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", padding: 3, borderWidth: StyleSheet.hairlineWidth, alignSelf: "center" },
  tab: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 9, minHeight: 38 },
});
