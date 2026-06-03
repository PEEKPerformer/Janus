import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { VisibleComment } from "../../core/comment-tree";
import type { JanusId } from "../../core/ids";
import type { Comment } from "../../core/model";
import { Vote } from "../../core/vote";
import { useTheme, type Theme } from "../theme";
import { compactNumber, relativeTime } from "../format";
import { Markdown } from "./Markdown";
import { VoteControl } from "./VoteControl";

const MAX_INDENT = 6;

function railColor(t: Theme, depth: number): string {
  const rails = t.colors.depthRails;
  return rails[(depth - 1) % rails.length];
}

/**
 * A single, flat, virtualizable comment row (the tree is flattened by
 * flattenVisible). Depth shows as a capped indent + neutral rail; tapping
 * toggles collapse. No recursion — so a huge thread can't stall the JS thread.
 */
export const CommentItem = React.memo(function CommentItem({
  item,
  onToggle,
  onReply,
  onVote,
  voteState,
}: {
  item: VisibleComment;
  onToggle: (id: JanusId) => void;
  onReply?: (comment: Comment) => void;
  onVote?: (comment: Comment, next: Vote) => void;
  /** Optimistic vote override from the screen; falls back to the comment's own. */
  voteState?: { vote: Vote; score: number };
}) {
  const t = useTheme();
  const { comment, depth, collapsed, descendantCount, hasChildren } = item;
  const indent = Math.min(depth, MAX_INDENT);
  const edited = !!comment.editedAt && comment.editedAt > comment.createdAt;
  const body = comment.body.text?.trim();
  const vote = voteState?.vote ?? comment.userVote;
  const score = voteState?.score ?? comment.score;

  return (
    <Pressable
      onPress={() => onToggle(comment.id)}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`Comment by ${comment.author.handle}, level ${depth}${
        collapsed ? `, collapsed, ${descendantCount} replies hidden` : ""
      }`}
      accessibilityHint={
        hasChildren ? "Double tap to collapse or expand replies" : undefined
      }
      style={[
        styles.row,
        {
          marginLeft: indent * 12,
          borderLeftWidth: depth > 0 ? 2 : 0,
          borderLeftColor: depth > 0 ? railColor(t, depth) : "transparent",
          paddingLeft: depth > 0 ? 10 : t.spacing.lg,
          paddingRight: t.spacing.lg,
          paddingVertical: t.spacing.sm + 2,
          backgroundColor: t.colors.bg,
          borderBottomColor: t.colors.border,
          opacity: collapsed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.metaRow}>
        <Text
          style={[
            t.type.small,
            {
              fontWeight: "700",
              color: comment.isOP ? t.colors.accent : t.colors.textSecondary,
              flexShrink: 1,
            },
          ]}
          numberOfLines={1}
        >
          {comment.author.handle}
        </Text>
        {comment.isOP ? (
          <Text
            style={[
              styles.badge,
              { color: t.colors.accent, borderColor: t.colors.accent },
            ]}
          >
            OP
          </Text>
        ) : null}
        {comment.distinguished === "moderator" ? (
          <Text
            style={[
              styles.badge,
              { color: t.colors.lemmy, borderColor: t.colors.lemmy },
            ]}
          >
            MOD
          </Text>
        ) : null}
        <Text
          style={[
            t.type.small,
            { color: t.colors.textTertiary, marginLeft: 6 },
          ]}
          numberOfLines={1}
        >
          {onVote
            ? ""
            : `${comment.scoreHidden ? "•" : compactNumber(score)} · `}
          {relativeTime(comment.createdAt)}
          {edited ? " · edited" : ""}
        </Text>
        <View style={{ flex: 1, minWidth: 8 }} />
        {collapsed && descendantCount > 0 ? (
          <Text
            style={[
              t.type.small,
              { color: t.colors.accent, fontWeight: "700" },
            ]}
          >
            +{descendantCount}
          </Text>
        ) : hasChildren ? (
          <Ionicons
            name="chevron-down"
            size={15}
            color={t.colors.textTertiary}
          />
        ) : null}
      </View>
      {!collapsed && body ? (
        <View style={{ marginTop: 4 }}>
          <Markdown source={body} color={t.colors.text} />
        </View>
      ) : null}
      {!collapsed && (onReply || onVote) ? (
        <View style={styles.actionRow}>
          {onVote ? (
            <VoteControl
              score={score}
              userVote={vote}
              scoreHidden={comment.scoreHidden}
              size={17}
              target="comment"
              onVote={(next) => onVote(comment, next)}
            />
          ) : null}
          {onReply ? (
            <Pressable
              onPress={() => onReply(comment)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Reply to ${comment.author.handle}`}
              style={[styles.actionBtn, onVote && { marginLeft: 8 }]}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={14}
                color={t.colors.textSecondary}
              />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.textSecondary, marginLeft: 5 },
                ]}
              >
                Reply
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth },
  metaRow: { flexDirection: "row", alignItems: "center" },
  actionRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
    paddingRight: 12,
  },
  badge: {
    marginLeft: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    fontSize: 10,
    fontWeight: "700",
    overflow: "hidden",
  },
});
