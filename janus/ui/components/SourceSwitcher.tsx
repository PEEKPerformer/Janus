import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useAdapters, type FeedScope } from "../AdapterContext";

const OPTIONS: {
  key: FeedScope;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "all", label: "All", icon: "layers" },
  { key: "reddit", label: "Reddit", icon: "logo-reddit" },
  { key: "lemmy", label: "Lemmy", icon: "planet" },
];

/**
 * Header segmented control choosing the feed scope: the unified "All" stream or
 * a single source. "All" is the default — the merged, source-annotated feed.
 */
export function SourceSwitcher() {
  const t = useTheme();
  const { feedScope, setFeedScope } = useAdapters();
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.pill,
        },
      ]}
      accessibilityRole="tablist"
    >
      {OPTIONS.map((o) => {
        const active = o.key === feedScope;
        // Darker *Active tints so white label/icon clears WCAG AA contrast.
        const tint =
          o.key === "reddit"
            ? t.colors.redditActive
            : o.key === "lemmy"
              ? t.colors.lemmyActive
              : t.colors.accentActive;
        return (
          <Pressable
            key={o.key}
            onPress={() => setFeedScope(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              o.key === "all" ? "Show all sources" : `Show ${o.label}`
            }
            style={[
              styles.tab,
              { borderRadius: t.radius.pill },
              active && { backgroundColor: tint },
            ]}
          >
            <Ionicons
              name={o.icon}
              size={14}
              color={active ? "#fff" : t.colors.textSecondary}
            />
            <Text
              style={[
                t.type.meta,
                {
                  marginLeft: 5,
                  color: active ? "#fff" : t.colors.textSecondary,
                },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "center",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 38,
  },
});
