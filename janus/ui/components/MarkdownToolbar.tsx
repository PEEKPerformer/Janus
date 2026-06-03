import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import type { FormatAction } from "../markdownEditor";

type McIcon = keyof typeof MaterialCommunityIcons.glyphMap;

const ACTIONS: { action: FormatAction; icon: McIcon; label: string }[] = [
  { action: "bold", icon: "format-bold", label: "Bold" },
  { action: "italic", icon: "format-italic", label: "Italic" },
  {
    action: "strikethrough",
    icon: "format-strikethrough",
    label: "Strikethrough",
  },
  { action: "link", icon: "link-variant", label: "Link" },
  { action: "quote", icon: "format-quote-close", label: "Quote" },
  { action: "bullet", icon: "format-list-bulleted", label: "Bulleted list" },
  { action: "numbered", icon: "format-list-numbered", label: "Numbered list" },
  { action: "heading", icon: "format-header-pound", label: "Heading" },
  { action: "code", icon: "code-tags", label: "Inline code" },
  { action: "codeblock", icon: "code-braces", label: "Code block" },
  { action: "spoiler", icon: "eye-off-outline", label: "Spoiler" },
];

/**
 * The comment editor's formatting bar. Rendered inside an InputAccessoryView so
 * it sits directly above the keyboard (the old hint-row buttons were hidden
 * behind it). Hosts the markdown format actions plus — prominently — the custom
 * emoji button and a preview toggle.
 */
export function MarkdownToolbar({
  onFormat,
  onEmoji,
  onTogglePreview,
  previewing,
}: {
  onFormat: (action: FormatAction) => void;
  /** Shown only when the instance has custom emoji (e.g. hexbear). */
  onEmoji?: () => void;
  onTogglePreview: () => void;
  previewing: boolean;
}) {
  const t = useTheme();
  const btn = (
    key: string,
    icon: McIcon,
    label: string,
    onPress: () => void,
    active = false,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: active
            ? t.colors.accentActive
            : pressed
              ? t.colors.cardPressed
              : "transparent",
          borderRadius: t.radius.sm,
        },
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={active ? "#fff" : t.colors.text}
      />
    </Pressable>
  );

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: t.colors.bgElevated,
          borderTopColor: t.colors.border,
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.scroll}
        style={styles.flex}
      >
        {ACTIONS.map((a) =>
          btn(a.action, a.icon, a.label, () => onFormat(a.action)),
        )}
      </ScrollView>

      <View style={[styles.trailing, { borderLeftColor: t.colors.border }]}>
        {onEmoji
          ? btn("emoji", "emoticon-happy-outline", "Insert emoji", onEmoji)
          : null}
        <Pressable
          onPress={onTogglePreview}
          accessibilityRole="button"
          accessibilityLabel={previewing ? "Edit" : "Preview"}
          accessibilityState={{ selected: previewing }}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: previewing
                ? t.colors.accentActive
                : pressed
                  ? t.colors.cardPressed
                  : "transparent",
              borderRadius: t.radius.sm,
            },
          ]}
        >
          <Ionicons
            name={previewing ? "create-outline" : "eye-outline"}
            size={20}
            color={previewing ? "#fff" : t.colors.text}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    minHeight: 46,
  },
  flex: { flex: 1 },
  scroll: { alignItems: "center", gap: 2, paddingHorizontal: 2 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 4,
    marginLeft: 2,
    gap: 2,
  },
  btn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
});
