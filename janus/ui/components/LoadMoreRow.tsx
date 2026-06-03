import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { VisibleComment } from "../../core/comment-tree";
import type { LoadMoreRef } from "../../core/model";
import { useTheme } from "../theme";

const MAX_INDENT = 6;

/** Human label for how many replies are hidden behind a load-more ref. */
function moreLabel(ref: LoadMoreRef): string {
  const n =
    ref.kind === "reddit"
      ? ref.childIds.length
      : ref.kind === "count-only"
        ? ref.missingCount
        : 0;
  if (n > 0) return `Load ${n} more ${n === 1 ? "reply" : "replies"}`;
  return "Load more replies";
}

/** A "continue thread" row for a comment whose subtree the server truncated. */
export function LoadMoreRow({
  item,
  busy,
  onPress,
}: {
  item: VisibleComment;
  busy: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const indent = Math.min(item.depth, MAX_INDENT);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={
        item.loadMore ? moreLabel(item.loadMore) : "Load more replies"
      }
      style={[
        styles.row,
        {
          marginLeft: indent * 12,
          borderLeftWidth: item.depth > 0 ? 2 : 0,
          borderLeftColor: item.depth > 0 ? t.colors.border : "transparent",
          paddingLeft: item.depth > 0 ? 10 : t.spacing.lg,
          borderBottomColor: t.colors.border,
          backgroundColor: t.colors.bg,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={t.colors.accent} />
      ) : (
        <Ionicons name="add-circle-outline" size={15} color={t.colors.accent} />
      )}
      <Text
        style={[
          t.type.small,
          { color: t.colors.accent, marginLeft: 8, fontWeight: "600" },
        ]}
      >
        {item.loadMore ? moreLabel(item.loadMore) : "Load more replies"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
