import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { TAG_COLORS, type UserTag } from "../../app/userTags";

/**
 * RES-style tag editor: a small sheet to pin a private label + color on a
 * user. Local-only; shown wherever the handle appears (both networks).
 */
export function UserTagEditor({
  visible,
  handle,
  current,
  onSave,
  onClose,
}: {
  visible: boolean;
  handle: string;
  current?: UserTag;
  /** null = remove the tag. */
  onSave: (tag: UserTag | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [label, setLabel] = useState(current?.label ?? "");
  const [color, setColor] = useState<string>(current?.color ?? TAG_COLORS[0]);

  // Re-seed when a different user's editor opens.
  useEffect(() => {
    if (visible) {
      setLabel(current?.label ?? "");
      setColor(current?.color ?? TAG_COLORS[0]);
    }
  }, [visible, handle]);

  const save = () => {
    const trimmed = label.trim();
    onSave(trimmed ? { label: trimmed, color } : null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: t.colors.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close tag editor"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.center}
        >
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: t.colors.bgElevated,
                borderColor: t.colors.border,
                borderRadius: t.radius.lg,
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.headerRow}>
              <Ionicons name="pricetag" size={16} color={color} />
              <Text
                style={[
                  t.type.body,
                  {
                    color: t.colors.text,
                    fontWeight: "700",
                    marginLeft: 8,
                    flex: 1,
                  },
                ]}
                numberOfLines={1}
              >
                Tag {handle}
              </Text>
            </View>
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginTop: 2 },
              ]}
            >
              Private note, shown wherever they appear — on both networks.
            </Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. GPU expert · met in r/buildapc"
              placeholderTextColor={t.colors.textTertiary}
              autoFocus
              maxLength={40}
              onSubmitEditing={save}
              accessibilityLabel="Tag text"
              style={[
                styles.input,
                {
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  color: t.colors.text,
                  backgroundColor: t.colors.bg,
                },
                t.type.body,
              ]}
            />
            <View style={styles.swatchRow}>
              {TAG_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tag color ${c}`}
                  accessibilityState={{ selected: color === c }}
                  style={[
                    styles.swatch,
                    { backgroundColor: c },
                    color === c && {
                      borderWidth: 2.5,
                      borderColor: t.colors.text,
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.btnRow}>
              {current ? (
                <Pressable
                  onPress={() => {
                    onSave(null);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Remove tag"
                  hitSlop={8}
                >
                  <Text style={[t.type.meta, { color: t.colors.danger }]}>
                    Remove
                  </Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={8}
                style={{ marginRight: 20 }}
              >
                <Text style={[t.type.meta, { color: t.colors.textSecondary }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={save}
                accessibilityRole="button"
                accessibilityLabel="Save tag"
                hitSlop={8}
              >
                <Text
                  style={[
                    t.type.meta,
                    { color: t.colors.accent, fontWeight: "700" },
                  ]}
                >
                  Save
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  center: { flex: 1, justifyContent: "center", padding: 24 },
  sheet: { padding: 18, borderWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: "row", alignItems: "center" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  swatchRow: { flexDirection: "row", marginTop: 14 },
  swatch: { width: 30, height: 30, borderRadius: 15, marginRight: 12 },
  btnRow: { flexDirection: "row", alignItems: "center", marginTop: 18 },
});
