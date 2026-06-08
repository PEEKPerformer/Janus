import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import type { ModAction } from "../../core/adapter";

export interface ModMenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  action: ModAction;
  destructive?: boolean;
}

/**
 * Bottom-sheet of moderator actions. Source-agnostic — the caller assembles the
 * applicable {@link ModMenuItem}s (which already differ per source/entity) and
 * receives the chosen {@link ModAction}. Looks and dismisses like a native iOS
 * action sheet.
 */
export function ModActionSheet({
  visible,
  title,
  items,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: ModMenuItem[];
  onSelect: (action: ModAction) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Dismiss moderation menu"
      >
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              paddingBottom: insets.bottom + 8,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle}>
            <View style={[styles.grip, { backgroundColor: t.colors.border }]} />
          </View>
          <View style={styles.titleRow}>
            <Ionicons
              name="shield-checkmark"
              size={16}
              color={t.colors.accent}
            />
            <Text
              style={[
                t.type.meta,
                { color: t.colors.textSecondary, marginLeft: 8 },
              ]}
            >
              {title}
            </Text>
          </View>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onSelect(item.action);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: pressed
                    ? t.colors.cardPressed
                    : "transparent",
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={item.destructive ? t.colors.danger : t.colors.text}
              />
              <Text
                style={[
                  t.type.body,
                  {
                    color: item.destructive ? t.colors.danger : t.colors.text,
                    marginLeft: 14,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  handle: { alignItems: "center", paddingVertical: 6 },
  grip: { width: 36, height: 4, borderRadius: 2 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
});
