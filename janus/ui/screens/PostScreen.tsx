import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { VoteControl } from "../components/VoteControl";
import { CommentItem } from "../components/CommentItem";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import { buildCommentTree, type CommentNode } from "../../core/comment-tree";
import { Vote } from "../../core/vote";
import { NotAuthenticatedError } from "../../core/errors";
import { compactNumber, relativeTime } from "../format";

type Props = NativeStackScreenProps<RootStackParamList, "Post">;

export function PostScreen({ route }: Props) {
  const t = useTheme();
  const { post } = route.params;
  const { adapters } = useAdapters();
  const adapter = adapters[post.source];

  const comments = useAsync(() => adapter.getComments(post.id, {}), [post.id]);
  const roots: CommentNode[] = useMemo(
    () => (comments.data ? buildCommentTree(comments.data.items) : []),
    [comments.data],
  );

  // Optimistic vote state for the post.
  const [vote, setVote] = useState<Vote>(post.userVote);
  const [score, setScore] = useState<number>(post.score);
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const onVote = async (next: Vote) => {
    const prevVote = vote;
    const prevScore = score;
    setVote(next);
    setScore(prevScore + (next - prevVote));
    try {
      await adapter.vote(post.id, next);
    } catch (e) {
      setVote(prevVote);
      setScore(prevScore);
      setToast(e instanceof NotAuthenticatedError ? "Sign in to vote" : "Couldn't vote — try again");
    }
  };

  const image = post.media.find((m) => m.kind === "image" || m.kind === "gallery");
  const sourceColor = post.source === "reddit" ? t.colors.reddit : t.colors.lemmy;

  const header = (
    <View style={{ backgroundColor: t.colors.bg }}>
      <View style={{ padding: t.spacing.lg }}>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: sourceColor }]} />
          <Text style={[t.type.meta, { color: t.colors.text, fontWeight: "600" }]}>{post.community.handle}</Text>
          <Text style={[t.type.small, { color: t.colors.textTertiary, marginLeft: 6 }]}>
            · {post.author.handle} · {relativeTime(post.createdAt)}
          </Text>
        </View>

        <Text style={[t.type.title, { color: t.colors.text, fontSize: 20, lineHeight: 26, marginTop: t.spacing.sm }]}>
          {post.title}
        </Text>

        {image ? (
          <Image
            source={{ uri: image.url }}
            style={[styles.image, { borderRadius: t.radius.md, backgroundColor: t.colors.skeleton, aspectRatio: Math.min(Math.max(image.aspectRatio ?? 1.4, 0.6), 1.8) }]}
            contentFit="contain"
            blurRadius={post.isNSFW ? 60 : 0}
            transition={150}
          />
        ) : null}

        {post.externalLink ? (
          <Text style={[t.type.meta, { color: t.colors.accent, marginTop: t.spacing.sm }]} numberOfLines={1}>
            {post.externalLink}
          </Text>
        ) : null}

        {post.body.text?.trim() ? (
          <View style={{ marginTop: t.spacing.md }}>
            <Markdown source={post.body.text} />
          </View>
        ) : null}

        <View style={[styles.footer, { marginTop: t.spacing.lg, borderTopColor: t.colors.border, paddingTop: t.spacing.md }]}>
          <VoteControl score={score} userVote={vote} scoreHidden={post.scoreHidden} onVote={onVote} />
          <View style={[styles.stat, { marginLeft: t.spacing.xl }]}>
            <Ionicons name="chatbubble-outline" size={15} color={t.colors.textSecondary} />
            <Text style={[t.type.meta, { color: t.colors.textSecondary, marginLeft: 5 }]}>
              {compactNumber(post.commentCount)}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.commentsHeader, { borderTopColor: t.colors.border, backgroundColor: t.colors.bgElevated }]}>
        <Text style={[t.type.meta, { color: t.colors.textSecondary }]}>
          {comments.data ? `${compactNumber(post.commentCount)} comments` : "Comments"}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <FlashList
        data={roots}
        keyExtractor={(n) => n.comment.id}
        renderItem={({ item }) => <CommentItem node={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          comments.loading ? (
            <LoadingView label="Loading comments…" />
          ) : comments.error ? (
            <ErrorView error={comments.error} onRetry={comments.reload} />
          ) : (
            <EmptyView title="No comments yet" detail="Be the first to comment." icon="chatbubbles-outline" />
          )
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
      {toast ? (
        <View style={[styles.toast, { backgroundColor: t.colors.text, borderRadius: t.radius.pill }]} accessibilityRole="alert">
          <Text style={[t.type.meta, { color: t.colors.bg }]}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  image: { width: "100%", marginTop: 12, maxHeight: 420 },
  footer: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth },
  stat: { flexDirection: "row", alignItems: "center" },
  commentsHeader: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  toast: { position: "absolute", bottom: 32, alignSelf: "center", paddingHorizontal: 18, paddingVertical: 10 },
});
