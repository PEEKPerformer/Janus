import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme";

/**
 * Markdown comment composer presented as a bottom sheet. Used for both
 * top-level comments and replies; `contextLabel` shows what's being replied to.
 */
export function CommentComposer({
  contextLabel,
  submitting,
  onSubmit,
  onCancel,
}: {
  contextLabel: string;
  submitting: boolean;
  onSubmit: (markdown: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !submitting;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.backdrop,
        { backgroundColor: t.colors.overlay },
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flexEnd}
      >
        <SafeAreaView
          edges={["bottom"]}
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
            },
          ]}
        >
          <View style={styles.bar}>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cancel comment"
            >
              <Text style={[t.type.meta, { color: t.colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
            <Text
              style={[
                t.type.meta,
                { color: t.colors.textTertiary, flex: 1, textAlign: "center" },
              ]}
              numberOfLines={1}
            >
              {contextLabel}
            </Text>
            <Pressable
              onPress={() => canSend && onSubmit(text.trim())}
              disabled={!canSend}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
              accessibilityState={{ disabled: !canSend }}
            >
              {submitting ? (
                <ActivityIndicator color={t.colors.accent} />
              ) : (
                <Text
                  style={[
                    t.type.meta,
                    {
                      color: canSend ? t.colors.accent : t.colors.textTertiary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  Post
                </Text>
              )}
            </Pressable>
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="Share your thoughts…"
            placeholderTextColor={t.colors.textTertiary}
            style={[t.type.body, styles.input, { color: t.colors.text }]}
            accessibilityLabel="Comment text"
            editable={!submitting}
          />
          <View style={styles.hintRow}>
            <Ionicons
              name="logo-markdown"
              size={14}
              color={t.colors.textTertiary}
            />
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginLeft: 6 },
              ]}
            >
              Markdown supported
            </Text>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { zIndex: 200 },
  flexEnd: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  input: {
    minHeight: 120,
    maxHeight: 240,
    textAlignVertical: "top",
    paddingTop: 4,
  },
  hintRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
});
