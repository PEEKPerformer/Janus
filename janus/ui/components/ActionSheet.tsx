import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

export interface ActionItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * Generic bottom action sheet (native-iOS feel). The caller assembles the
 * applicable {@link ActionItem}s — source/entity differences are decided there,
 * so this stays presentation-only and reusable across post/comment/community
 * long-press menus.
 */
export function ActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title?: string;
  items: ActionItem[];
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
        accessibilityLabel="Dismiss menu"
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
          {title ? (
            <Text
              style={[
                t.type.small,
                styles.title,
                { color: t.colors.textTertiary },
              ]}
              numberOfLines={2}
            >
              {title}
            </Text>
          ) : null}
          {items.map((item, i) => (
            <Pressable
              key={`${item.label}-${i}`}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [
                styles.row,
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
                    marginLeft: 14,
                    color: item.destructive ? t.colors.danger : t.colors.text,
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
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  handle: { alignItems: "center", paddingVertical: 8 },
  grip: { width: 38, height: 5, borderRadius: 3 },
  title: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
});
