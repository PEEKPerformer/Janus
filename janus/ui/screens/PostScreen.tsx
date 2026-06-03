import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { VoteControl } from "../components/VoteControl";
import { CommentItem } from "../components/CommentItem";
import { CommentComposer } from "../components/CommentComposer";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import { buildCommentTree, flattenVisible } from "../../core/comment-tree";
import type { JanusId } from "../../core/ids";
import type { Comment } from "../../core/model";
import { Vote } from "../../core/vote";
import { NotAuthenticatedError } from "../../core/errors";
import { compactNumber, relativeTime } from "../format";
import { openExternal, isHttpUrl } from "../links";

type Props = NativeStackScreenProps<RootStackParamList, "Post">;

export function PostScreen({ route }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { post } = route.params;
  const { adapters } = useAdapters();
  const adapter = adapters[post.source];

  const comments = useAsync(() => adapter.getComments(post.id, {}), [post.id]);
  // Locally-submitted comments, merged into the fetched set and re-threaded.
  const [extraComments, setExtraComments] = useState<Comment[]>([]);
  const roots = useMemo(
    () => buildCommentTree([...(comments.data?.items ?? []), ...extraComments]),
    [comments.data, extraComments],
  );

  const [collapsed, setCollapsed] = useState<Set<JanusId>>(new Set());
  const toggle = useCallback((id: JanusId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const visible = useMemo(
    () => flattenVisible(roots, collapsed),
    [roots, collapsed],
  );

  // Optimistic vote state.
  const [vote, setVote] = useState<Vote>(post.userVote);
  const [score, setScore] = useState<number>(post.score);
  const [saved, setSaved] = useState<boolean>(post.saved);
  const [toast, setToast] = useState<string>();
  const votingRef = useRef(false);
  const savingRef = useRef(false);

  // Reply composer: replyTo is the thing being replied to (the post itself for
  // a top-level comment, or a specific comment) plus a human label.
  const [replyTo, setReplyTo] = useState<{
    parentId: JanusId;
    label: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!toast) return;
    AccessibilityInfo.announceForAccessibility(toast);
    const id = setTimeout(() => setToast(undefined), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const onVote = async (next: Vote) => {
    if (votingRef.current) return;
    // Known-anonymous: skip the optimistic flip-and-revert glitch entirely.
    if (adapter.account.isGuest) {
      setToast("Sign in to vote");
      return;
    }
    votingRef.current = true;
    const prevVote = vote;
    const prevScore = score;
    setVote(next);
    setScore(prevScore + (next - prevVote));
    try {
      await adapter.vote(post.id, next);
    } catch (e) {
      setVote(prevVote);
      setScore(prevScore);
      setToast(
        e instanceof NotAuthenticatedError
          ? "Sign in to vote"
          : "Couldn't vote — try again",
      );
    } finally {
      votingRef.current = false;
    }
  };

  const onToggleSave = async () => {
    if (savingRef.current) return;
    if (adapter.account.isGuest) {
      setToast("Sign in to save");
      return;
    }
    savingRef.current = true;
    const next = !saved;
    setSaved(next);
    try {
      await adapter.save(post.id, next);
      setToast(next ? "Saved" : "Removed from saved");
    } catch (e) {
      setSaved(!next);
      setToast(
        e instanceof NotAuthenticatedError
          ? "Sign in to save"
          : "Couldn't save — try again",
      );
    } finally {
      savingRef.current = false;
    }
  };

  const startReply = (target?: Comment) => {
    if (adapter.account.isGuest) {
      setToast("Sign in to comment");
      return;
    }
    if (target)
      setReplyTo({
        parentId: target.id,
        label: `Replying to ${target.author.handle}`,
      });
    else setReplyTo({ parentId: post.id, label: "Add a comment" });
  };

  const submitReply = async (markdown: string) => {
    if (!replyTo || submitting) return;
    setSubmitting(true);
    try {
      const created = await adapter.submitComment({
        postId: post.id,
        parentId: replyTo.parentId,
        markdown,
      });
      setExtraComments((prev) => [...prev, created]);
      setReplyTo(null);
      setToast("Comment posted");
    } catch (e) {
      setToast(
        e instanceof NotAuthenticatedError
          ? "Sign in to comment"
          : "Couldn't post — try again",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const image = post.media.find(
    (m) => m.kind === "image" || m.kind === "gallery",
  );
  const imageUri = isHttpUrl(image?.url)
    ? image!.url
    : isHttpUrl(image?.thumbnailUrl)
      ? image!.thumbnailUrl
      : undefined;
  const obscured = post.isNSFW || post.isSpoiler;
  const sourceColor =
    post.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const edited = !!post.editedAt && post.editedAt > post.createdAt;

  const header = (
    <View style={{ backgroundColor: t.colors.bg }}>
      <View style={{ padding: t.spacing.lg }}>
        <View style={styles.metaRow}>
          {isHttpUrl(post.community.icon) ? (
            <Image
              source={{ uri: post.community.icon }}
              style={[styles.avatar, { borderColor: sourceColor }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.dot, { backgroundColor: sourceColor }]} />
          )}
          <Text
            style={[
              t.type.meta,
              {
                color: t.colors.text,
                fontWeight: "600",
                flexShrink: 1,
                marginLeft: 8,
              },
            ]}
            numberOfLines={1}
          >
            {post.community.handle}
          </Text>
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, marginLeft: 6 },
            ]}
            numberOfLines={1}
          >
            · {relativeTime(post.createdAt)}
            {edited ? " · edited" : ""}
          </Text>
        </View>
        <Text
          style={[t.type.small, { color: t.colors.textTertiary, marginTop: 2 }]}
          numberOfLines={1}
        >
          by {post.author.handle}
        </Text>

        <Text
          style={[
            t.type.title,
            {
              color: t.colors.text,
              fontSize: 20,
              lineHeight: 26,
              marginTop: t.spacing.sm,
            },
          ]}
        >
          {post.title}
        </Text>

        {imageUri ? (
          <View style={{ marginTop: t.spacing.md }}>
            <Image
              source={{ uri: imageUri }}
              style={[
                styles.image,
                {
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.skeleton,
                  aspectRatio: Math.min(
                    Math.max(image?.aspectRatio ?? 1.4, 0.6),
                    1.8,
                  ),
                },
              ]}
              contentFit="contain"
              recyclingKey={post.id}
              blurRadius={obscured ? 55 : 0}
              transition={150}
            />
            {obscured ? (
              <View
                style={[styles.obscure, { borderRadius: t.radius.md }]}
                pointerEvents="none"
              >
                <Ionicons name="eye-off" size={20} color="#fff" />
                <Text style={[t.type.meta, { color: "#fff", marginTop: 4 }]}>
                  {post.isNSFW ? "NSFW" : "SPOILER"}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {post.externalLink ? (
          <Pressable
            onPress={() => openExternal(post.externalLink!)}
            accessibilityRole="link"
            accessibilityLabel={`Open link ${post.externalLink}`}
            style={[
              styles.linkRow,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.bgElevated,
              },
            ]}
          >
            <Ionicons name="open-outline" size={16} color={t.colors.accent} />
            <Text
              style={[
                t.type.meta,
                { color: t.colors.accent, marginLeft: 8, flex: 1 },
              ]}
              numberOfLines={1}
            >
              {post.externalLink}
            </Text>
          </Pressable>
        ) : null}

        {post.body.text?.trim() ? (
          <View style={{ marginTop: t.spacing.md }}>
            <Markdown source={post.body.text} />
          </View>
        ) : null}

        <View
          style={[
            styles.footer,
            {
              marginTop: t.spacing.lg,
              borderTopColor: t.colors.border,
              paddingTop: t.spacing.md,
            },
          ]}
        >
          <VoteControl
            score={score}
            userVote={vote}
            scoreHidden={post.scoreHidden}
            onVote={onVote}
          />
          <Pressable
            onPress={() => startReply()}
            accessibilityRole="button"
            accessibilityLabel="Add a comment"
            hitSlop={8}
            style={[styles.stat, { marginLeft: t.spacing.xl }]}
          >
            <Ionicons
              name="chatbubble-outline"
              size={15}
              color={t.colors.textSecondary}
            />
            <Text
              style={[
                t.type.meta,
                { color: t.colors.textSecondary, marginLeft: 5 },
              ]}
            >
              {compactNumber(post.commentCount)}
            </Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={onToggleSave}
            accessibilityRole="button"
            accessibilityLabel={saved ? "Remove from saved" : "Save post"}
            accessibilityState={{ selected: saved }}
            hitSlop={8}
            style={styles.stat}
          >
            <Ionicons
              name={saved ? "bookmark" : "bookmark-outline"}
              size={16}
              color={saved ? t.colors.accent : t.colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <View
        style={[
          styles.commentsHeader,
          {
            borderTopColor: t.colors.border,
            backgroundColor: t.colors.bgElevated,
            paddingHorizontal: t.spacing.lg,
          },
        ]}
      >
        <Text style={[t.type.meta, { color: t.colors.textSecondary }]}>
          {compactNumber(post.commentCount)} comments
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <FlashList
        data={visible}
        keyExtractor={(v) => v.comment.id}
        renderItem={({ item }) => (
          <CommentItem item={item} onToggle={toggle} onReply={startReply} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          comments.loading ? (
            <LoadingView label="Loading comments…" />
          ) : comments.error ? (
            <ErrorView
              error={comments.error}
              onRetry={comments.reload}
              sourceLabel={post.instance}
            />
          ) : (
            <EmptyView
              title="No comments yet"
              detail="Be the first to comment."
              icon="chatbubbles-outline"
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={comments.loading && roots.length > 0}
            onRefresh={comments.reload}
            tintColor={t.colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      />
      {toast ? (
        <View
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 24,
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.pill,
            },
          ]}
          accessibilityRole="alert"
        >
          <Ionicons name="lock-closed" size={14} color={t.colors.accent} />
          <Text style={[t.type.meta, { color: t.colors.text, marginLeft: 8 }]}>
            {toast}
          </Text>
        </View>
      ) : null}
      {replyTo ? (
        <CommentComposer
          contextLabel={replyTo.label}
          submitting={submitting}
          onSubmit={submitReply}
          onCancel={() => setReplyTo(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  dot: { width: 9, height: 9, borderRadius: 5 },
  avatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  image: { width: "100%", maxHeight: 420 },
  obscure: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: { flexDirection: "row", alignItems: "center" },
  commentsHeader: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
