import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  InputAccessoryView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { EmojiPicker } from "./EmojiPicker";
import { Markdown } from "./Markdown";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { applyFormat, type Selection } from "../markdownEditor";
import type { CustomEmoji } from "../../core/model";

const ACCESSORY_ID = "janus.comment.format";

/**
 * Rich, Reddit-style markdown comment composer (bottom sheet). A formatting
 * toolbar — bold/italic/link/quote/list/code/spoiler plus custom emoji and a
 * live-preview toggle — rides in an iOS InputAccessoryView so it sits directly
 * above the keyboard instead of being hidden behind it. Output stays markdown so
 * edits round-trip. Used for top-level comments and replies.
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
  /** Drives source-specific syntax (e.g. spoilers). */
  source?: "reddit" | "lemmy";
  customEmojis?: CustomEmoji[];
  popularEmoji?: string[];
  emojiInstance?: string;
  onSubmit: (markdown: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState(initialText);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pendingSel, setPendingSel] = useState<Selection | undefined>(
    undefined,
  );
  const selRef = useRef<Selection>({
    start: initialText.length,
    end: initialText.length,
  });
  const inputRef = useRef<TextInput>(null);
  const canSend = text.trim().length > 0 && !submitting;
  const hasEmoji = !!customEmojis && customEmojis.length > 0;

  const applyAndRefocus = (result: { text: string; selection: Selection }) => {
    setText(result.text);
    selRef.current = result.selection;
    setPendingSel(result.selection);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const format = (action: Parameters<typeof applyFormat>[0]) =>
    applyAndRefocus(applyFormat(action, text, selRef.current, { source }));

  const insertEmoji = (e: CustomEmoji) => {
    const sel = selRef.current;
    const needsSpace = sel.start > 0 && !/\s$/.test(text.slice(0, sel.start));
    const insert = `${needsSpace ? " " : ""}${e.markdown} `;
    const next = text.slice(0, sel.start) + insert + text.slice(sel.end);
    const pos = sel.start + insert.length;
    applyAndRefocus({ text: next, selection: { start: pos, end: pos } });
  };

  const togglePreview = () => {
    if (!previewing) inputRef.current?.blur();
    setPreviewing((p) => !p);
  };

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

          {previewing ? (
            <Pressable
              onPress={togglePreview}
              accessibilityRole="button"
              accessibilityLabel="Back to editing"
              style={styles.preview}
            >
              {text.trim() ? (
                <ScrollView style={styles.previewScroll}>
                  <Markdown source={text} />
                </ScrollView>
              ) : (
                <Text style={[t.type.body, { color: t.colors.textTertiary }]}>
                  Nothing to preview yet.
                </Text>
              )}
            </Pressable>
          ) : (
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              onSelectionChange={(e) => {
                selRef.current = e.nativeEvent.selection;
                if (pendingSel) setPendingSel(undefined);
              }}
              selection={pendingSel}
              multiline
              autoFocus
              placeholder="Share your thoughts…"
              placeholderTextColor={t.colors.textTertiary}
              style={[t.type.body, styles.input, { color: t.colors.text }]}
              accessibilityLabel="Comment text"
              editable={!submitting}
              inputAccessoryViewID={
                Platform.OS === "ios" ? ACCESSORY_ID : undefined
              }
            />
          )}

          {/* Non-iOS: the bar can't ride the keyboard, so pin it inline. */}
          {Platform.OS !== "ios" ? (
            <MarkdownToolbar
              onFormat={format}
              onEmoji={hasEmoji ? () => setEmojiOpen(true) : undefined}
              onTogglePreview={togglePreview}
              previewing={previewing}
            />
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={ACCESSORY_ID}>
          <MarkdownToolbar
            onFormat={format}
            onEmoji={hasEmoji ? () => setEmojiOpen(true) : undefined}
            onTogglePreview={togglePreview}
            previewing={previewing}
          />
        </InputAccessoryView>
      ) : null}

      {emojiOpen && customEmojis ? (
        <EmojiPicker
          emojis={customEmojis}
          popular={popularEmoji}
          instance={emojiInstance}
          onSelect={insertEmoji}
          onClose={() => setEmojiOpen(false)}
        />
      ) : null}
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
    paddingBottom: 12,
  },
  preview: { minHeight: 120, maxHeight: 280, paddingVertical: 6 },
  previewScroll: { flexGrow: 0 },
});
