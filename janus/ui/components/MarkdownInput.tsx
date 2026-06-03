import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../theme";
import { EmojiPicker } from "./EmojiPicker";
import { Markdown } from "./Markdown";
import { MarkdownToolbar } from "./MarkdownToolbar";
import {
  applyFormat,
  type EditResult,
  type Selection,
} from "../markdownEditor";
import type { CustomEmoji } from "../../core/model";

/**
 * Reusable rich markdown editor: a multiline input with a formatting toolbar
 * (bold/italic/link/quote/list/code/spoiler), custom-emoji insertion, and a
 * live-preview toggle. The toolbar renders inline directly beneath the input;
 * the host container lifts it above the keyboard (InputAccessoryView can't be
 * used here — iOS doesn't support it for multiline inputs). Shared by the
 * comment composer, DMs, and the post body so every place you write markdown
 * behaves identically. Controlled via `value`/`onChangeValue`.
 */
export function MarkdownInput({
  value,
  onChangeValue,
  placeholder,
  accessibilityLabel = "Markdown text",
  source,
  customEmojis,
  popularEmoji = [],
  emojiInstance,
  autoFocus,
  editable = true,
  minHeight = 120,
  maxHeight = 240,
  inputStyle,
}: {
  value: string;
  onChangeValue: (v: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  /** Drives source-specific syntax (e.g. spoilers). */
  source?: "reddit" | "lemmy";
  customEmojis?: CustomEmoji[];
  popularEmoji?: string[];
  emojiInstance?: string;
  autoFocus?: boolean;
  editable?: boolean;
  minHeight?: number;
  maxHeight?: number;
  inputStyle?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [previewing, setPreviewing] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingSel, setPendingSel] = useState<Selection | undefined>(
    undefined,
  );
  const selRef = useRef<Selection>({ start: value.length, end: value.length });
  const inputRef = useRef<TextInput>(null);
  const hasEmoji = !!customEmojis && customEmojis.length > 0;

  const apply = (result: EditResult) => {
    onChangeValue(result.text);
    selRef.current = result.selection;
    setPendingSel(result.selection);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const format = (action: Parameters<typeof applyFormat>[0]) =>
    apply(applyFormat(action, value, selRef.current, { source }));

  const insertEmoji = (e: CustomEmoji) => {
    const sel = selRef.current;
    const needsSpace = sel.start > 0 && !/\s$/.test(value.slice(0, sel.start));
    const insert = `${needsSpace ? " " : ""}${e.markdown} `;
    const next = value.slice(0, sel.start) + insert + value.slice(sel.end);
    const pos = sel.start + insert.length;
    apply({ text: next, selection: { start: pos, end: pos } });
  };

  const togglePreview = () => {
    if (!previewing) inputRef.current?.blur();
    setPreviewing((p) => !p);
  };

  const toolbar = (
    <MarkdownToolbar
      onFormat={format}
      onEmoji={hasEmoji ? () => setEmojiOpen(true) : undefined}
      onTogglePreview={togglePreview}
      previewing={previewing}
    />
  );

  return (
    <>
      {previewing ? (
        <Pressable
          onPress={togglePreview}
          accessibilityRole="button"
          accessibilityLabel="Back to editing"
          style={[styles.preview, { minHeight }]}
        >
          {value.trim() ? (
            <ScrollView style={{ maxHeight }}>
              <Markdown source={value} />
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
          value={value}
          onChangeText={onChangeValue}
          onSelectionChange={(e) => {
            selRef.current = e.nativeEvent.selection;
            if (pendingSel) setPendingSel(undefined);
          }}
          selection={pendingSel}
          multiline
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={t.colors.textTertiary}
          style={[
            t.type.body,
            styles.input,
            { color: t.colors.text, minHeight, maxHeight },
            inputStyle,
          ]}
          accessibilityLabel={accessibilityLabel}
          editable={editable}
        />
      )}

      {/* Inline toolbar directly under the input. The containing sheet lifts
          above the keyboard (InputAccessoryView is unsupported for multiline). */}
      {toolbar}

      {/* Wrapped in a Modal so the full-screen overlay escapes whatever (possibly
          sheet-sized) container the editor is mounted in. */}
      <Modal
        visible={emojiOpen && hasEmoji}
        transparent
        animationType="fade"
        onRequestClose={() => setEmojiOpen(false)}
      >
        {customEmojis ? (
          <EmojiPicker
            emojis={customEmojis}
            popular={popularEmoji}
            instance={emojiInstance}
            onSelect={insertEmoji}
            onClose={() => setEmojiOpen(false)}
          />
        ) : (
          <View />
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  input: { textAlignVertical: "top", paddingTop: 4, paddingBottom: 12 },
  preview: { paddingVertical: 6 },
});
