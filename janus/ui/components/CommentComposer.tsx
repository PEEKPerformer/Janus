import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { useKeyboardHeight } from "../useKeyboardHeight";
import { MarkdownInput } from "./MarkdownInput";
import type { CustomEmoji } from "../../core/model";

/**
 * Rich, Reddit-style markdown comment composer (bottom sheet). The editing
 * surface — formatting toolbar, custom emoji, live preview — is the shared
 * {@link MarkdownInput}, so comments, DMs, and post bodies all behave the same.
 * Output stays markdown so edits round-trip. Used for top-level comments and
 * replies (and DMs, with submitLabel="Send").
 */
export function CommentComposer({
  contextLabel,
  submitting,
  initialText = "",
  submitLabel = "Post",
  source,
  customEmojis,
  popularEmoji = [],
  emojiInstance,
  onSubmit,
  onCancel,
}: {
  contextLabel: string;
  submitting: boolean;
  initialText?: string;
  submitLabel?: string;
  source?: "reddit" | "lemmy";
  customEmojis?: CustomEmoji[];
  popularEmoji?: string[];
  emojiInstance?: string;
  onSubmit: (markdown: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [text, setText] = useState(initialText);
  const canSend = text.trim().length > 0 && !submitting;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.backdrop,
        styles.flexEnd,
        { backgroundColor: t.colors.overlay },
      ]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Dismiss composer"
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            // Lift above the keyboard (deterministic), else respect the home bar.
            marginBottom: keyboard > 0 ? keyboard : insets.bottom,
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
            accessibilityLabel={
              submitLabel === "Post" ? "Post comment" : submitLabel
            }
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
                {submitLabel}
              </Text>
            )}
          </Pressable>
        </View>

        <MarkdownInput
          value={text}
          onChangeValue={setText}
          placeholder="Share your thoughts…"
          accessibilityLabel="Comment text"
          source={source}
          customEmojis={customEmojis}
          popularEmoji={popularEmoji}
          emojiInstance={emojiInstance}
          autoFocus
          editable={!submitting}
        />
      </View>
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
});
