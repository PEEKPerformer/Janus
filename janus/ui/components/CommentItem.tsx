import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CommentNode } from "../../core/comment-tree";
import { useTheme, type Theme } from "../theme";
import { compactNumber, relativeTime } from "../format";
import { Markdown } from "./Markdown";

function depthColor(t: Theme, depth: number): string {
  const ramp = [t.colors.accent, t.colors.lemmy, t.colors.upvote, t.colors.downvote, t.colors.reddit];
  return ramp[(depth - 1) % ramp.length];
}

function countDescendants(node: CommentNode): number {
  return node.replies.reduce((n, r) => n + 1 + countDescendants(r), 0);
}

export function CommentItem({ node, depth = 0 }: { node: CommentNode; depth?: number }) {
  const t = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const { comment } = node;
  const hidden = countDescendants(node);

  return (
    <View>
      <Pressable
        onPress={() => setCollapsed((c) => !c)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`Comment by ${comment.author.handle}${collapsed ? ", collapsed" : ""}`}
        style={[
          styles.row,
          {
            marginLeft: depth * 12,
            borderLeftWidth: depth > 0 ? 2 : 0,
            borderLeftColor: depth > 0 ? depthColor(t, depth) : "transparent",
            paddingLeft: depth > 0 ? 10 : t.spacing.lg,
            paddingRight: t.spacing.lg,
            paddingVertical: t.spacing.sm,
            backgroundColor: t.colors.bg,
            borderBottomColor: t.colors.border,
          },
        ]}
      >
        <View style={styles.metaRow}>
          <Text
            style={[
              t.type.small,
              { fontWeight: "700", color: comment.isOP ? t.colors.accent : t.colors.textSecondary },
            ]}
            numberOfLines={1}
          >
            {comment.author.handle}
          </Text>
          {comment.isOP ? <Text style={[styles.badge, t.type.small, { color: t.colors.accent, borderColor: t.colors.accent }]}>OP</Text> : null}
          {comment.distinguished === "moderator" ? (
            <Text style={[styles.badge, t.type.small, { color: t.colors.lemmy, borderColor: t.colors.lemmy }]}>MOD</Text>
          ) : null}
          <Text style={[t.type.small, { color: t.colors.textTertiary, marginLeft: 6 }]}>
            · {comment.scoreHidden ? "•" : compactNumber(comment.score)} · {relativeTime(comment.createdAt)}
          </Text>
          <View style={{ flex: 1 }} />
          {collapsed && hidden > 0 ? (
            <Text style={[t.type.small, { color: t.colors.textTertiary }]}>+{hidden}</Text>
          ) : (
            <Ionicons name="chevron-up" size={13} color={t.colors.textTertiary} />
          )}
        </View>
        {!collapsed ? (
          <View style={{ marginTop: 4 }}>
            <Markdown source={comment.body.text ?? ""} color={t.colors.text} />
          </View>
        ) : null}
      </Pressable>
      {!collapsed
        ? node.replies.map((child) => <CommentItem key={child.comment.id} node={child} depth={depth + 1} />)
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth },
  metaRow: { flexDirection: "row", alignItems: "center" },
  badge: { marginLeft: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, paddingHorizontal: 4, fontSize: 10, overflow: "hidden" },
});
