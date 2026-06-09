import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { useSettings } from "../SettingsContext";
import { getCommunitySort, setCommunitySort } from "../../app/communityPrefs";
import { bumpUsage } from "../../app/usageStats";
import { initThreadVisits, recordVisit } from "../../app/threadVisits";
import {
  initUserTags,
  getUserTag,
  setUserTag,
  removeUserTag,
} from "../../app/userTags";
import { findThreadMatches, isNewComment } from "../threadSearch";
import { UserTagEditor } from "../components/UserTagEditor";
import { diffNewIds, LIVE_REFRESH_MS } from "../liveThread";
import {
  initReadLater,
  isReadLater,
  toggleReadLater,
} from "../../app/readLater";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { CollapsibleBody } from "../components/CollapsibleBody";
import { InlineVideo } from "../components/InlineVideo";
import { PollView } from "../components/PollView";
import { CrosspostCard } from "../components/CrosspostCard";
import { ModActionSheet, type ModMenuItem } from "../components/ModActionSheet";
import { SelectTextModal } from "../components/SelectTextModal";
import type { ModAction } from "../../core/adapter";
import { VoteControl } from "../components/VoteControl";
import { CommentItem } from "../components/CommentItem";
import { SwipeableVoteRow } from "../components/SwipeableVoteRow";
import { LoadMoreRow } from "../components/LoadMoreRow";
import { CommentComposer } from "../components/CommentComposer";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import {
  buildCommentTree,
  flattenVisible,
  type VisibleComment,
} from "../../core/comment-tree";
import type { JanusId } from "../../core/ids";
import type { Comment } from "../../core/model";
import { Vote } from "../../core/vote";
import { NotAuthenticatedError } from "../../core/errors";
import { compactNumber, relativeTime } from "../format";
import { openExternal, isHttpUrl, postShareUrl } from "../links";
import { promptReport } from "../reportFlow";
import { popularEmojiFor } from "../emojiPopular";

type Props = NativeStackScreenProps<RootStackParamList, "Post">;

export function PostScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { post } = route.params;
  const { adapters } = useAdapters();
  const { settings } = useSettings();
  const adapter = adapters[post.source];

  // Some instances (Hexbear) disable downvotes — hide the down arrow there.
  const downvotes = useAsync(
    () =>
      adapter.getDownvotesEnabled
        ? adapter.getDownvotesEnabled()
        : Promise.resolve(true),
    [adapter],
  );
  const allowDownvote = downvotes.data ?? true;

  // Instance custom emoji for the composer picker (Lemmy/Hexbear).
  const customEmojis = useAsync(
    () =>
      adapter.getCustomEmojis ? adapter.getCustomEmojis() : Promise.resolve([]),
    [adapter],
  );

  const commentSorts = adapter.capabilities.sorts.comment;
  // Resolve the user's default comment sort against this adapter's options
  // case-insensitively (Lemmy ids are PascalCase, Reddit lowercase), so one
  // unified preference like "top" works across both sources.
  const defaultCommentSort =
    commentSorts.find(
      (s) => s.id.toLowerCase() === settings.defaultCommentSort.toLowerCase(),
    )?.id ??
    commentSorts[0]?.id ??
    "";
  const [commentSort, setCommentSort] = useState<string>(defaultCommentSort);
  // Honour the community's remembered comment sort (if enabled).
  useEffect(() => {
    if (!settings.rememberCommunitySort) return;
    let alive = true;
    void getCommunitySort(post.community.id, "comment").then((saved) => {
      if (alive && saved && commentSorts.some((s) => s.id === saved)) {
        setCommentSort(saved);
      }
    });
    return () => {
      alive = false;
    };
  }, [post.community.id]);
  const comments = useAsync(
    () => adapter.getComments(post.id, { sort: commentSort || undefined }),
    [post.id, commentSort],
  );
  // Locally-submitted comments, merged into the fetched set and re-threaded.
  const [extraComments, setExtraComments] = useState<Comment[]>([]);

  // Live thread mode: a silent refetch loop replaces the comment set while
  // you watch (game threads, AMAs); fresh arrivals get the NEW treatment.
  // Source-agnostic — it's just adapter.getComments on a timer.
  const [live, setLive] = useState(false);
  const [liveComments, setLiveComments] = useState<Comment[] | null>(null);
  const [liveNewIds, setLiveNewIds] = useState<Set<string>>(new Set());
  const baseComments = liveComments ?? comments.data?.items ?? [];
  const roots = useMemo(
    () => buildCommentTree([...baseComments, ...extraComments]),
    [liveComments, comments.data, extraComments],
  );
  useEffect(() => {
    // Leaving the sort (or toggling off) invalidates the live snapshot.
    setLiveComments(null);
    setLiveNewIds(new Set());
  }, [commentSort, live]);
  const knownIdsRef = useRef<Set<string>>(new Set());
  knownIdsRef.current = new Set(
    [...baseComments, ...extraComments].map((c) => c.id as string),
  );
  useEffect(() => {
    if (!live) return;
    const tick = setInterval(async () => {
      try {
        const page = await adapter.getComments(post.id, {
          sort: commentSort || undefined,
        });
        const fresh = diffNewIds(knownIdsRef.current, page.items);
        setLiveComments(page.items);
        if (fresh.length > 0) {
          setLiveNewIds((prev) => new Set([...prev, ...fresh]));
          setToast(
            `+${fresh.length} new comment${fresh.length === 1 ? "" : "s"}`,
          );
        }
      } catch {
        /* transient network hiccup — next tick retries */
      }
    }, LIVE_REFRESH_MS);
    return () => clearInterval(tick);
  }, [live, commentSort, adapter, post.id]);

  const [collapsed, setCollapsed] = useState<Set<JanusId>>(new Set());
  const toggle = useCallback((id: JanusId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Comments whose truncated subtree the user has already expanded (hides the
  // "load more" row), plus the ids currently being fetched (spinner).
  const [loadedMore, setLoadedMore] = useState<Set<JanusId>>(new Set());
  const [loadingMore, setLoadingMore] = useState<Set<JanusId>>(new Set());
  const visible = useMemo(
    () => flattenVisible(roots, collapsed, loadedMore),
    [roots, collapsed, loadedMore],
  );

  // Optionally start AutoModerator's top-level comment collapsed — seeded once
  // per post, so the user can still expand it and it won't re-collapse.
  const autoModSeeded = useRef<string | null>(null);
  useEffect(() => {
    if (!settings.collapseAutoModerator || roots.length === 0) return;
    if (autoModSeeded.current === post.id) return;
    autoModSeeded.current = post.id;
    const botIds = roots
      .filter(
        (r) => r.comment.author.username.toLowerCase() === "automoderator",
      )
      .map((r) => r.comment.id);
    if (botIds.length) {
      setCollapsed((prev) => new Set([...prev, ...botIds]));
    }
  }, [roots, settings.collapseAutoModerator, post.id]);

  // Jump-to-next-top-level-comment: each tap advances through the root comments.
  const listRef = useRef<FlashListRef<VisibleComment> | null>(null);
  const rootIndices = useMemo(
    () => visible.flatMap((v, i) => (!v.loadMore && v.depth === 0 ? [i] : [])),
    [visible],
  );
  const nextCursor = useRef(-1);
  const scrollToNextComment = () => {
    if (rootIndices.length === 0) return;
    nextCursor.current = (nextCursor.current + 1) % rootIndices.length;
    listRef.current?.scrollToIndex({
      index: rootIndices[nextCursor.current],
      animated: true,
      viewPosition: 0,
    });
  };

  // "Select text" sheet target (post or comment body), null when closed.
  const [selectText, setSelectText] = useState<string | null>(null);

  const onLoadMore = useCallback(
    async (parent: Comment, ref: import("../../core/model").LoadMoreRef) => {
      if (loadingMore.has(parent.id) || loadedMore.has(parent.id)) return;
      setLoadingMore((prev) => new Set(prev).add(parent.id));
      try {
        const more = await adapter.loadMoreComments(post.id, ref);
        setExtraComments((prev) => [...prev, ...more]);
        setLoadedMore((prev) => new Set(prev).add(parent.id));
      } catch {
        setToast("Couldn't load more — try again");
      } finally {
        setLoadingMore((prev) => {
          const next = new Set(prev);
          next.delete(parent.id);
          return next;
        });
      }
    },
    [adapter, post.id, loadingMore, loadedMore],
  );

  // Optimistic vote state.
  const [vote, setVote] = useState<Vote>(post.userVote);
  const [score, setScore] = useState<number>(post.score);
  const [saved, setSaved] = useState<boolean>(post.saved);
  const [postBody, setPostBody] = useState<string | undefined>(post.body.text);
  const [toast, setToast] = useState<string>();
  const votingRef = useRef(false);
  const savingRef = useRef(false);

  // Composer: a reply (to the post or a comment) or an edit of own content.
  const [composer, setComposer] = useState<{
    mode: "reply" | "edit";
    targetId: JanusId;
    label: string;
    initial: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Local edits/deletes of the user's own comments (optimistic overrides).
  const [editedBodies, setEditedBodies] = useState<Map<JanusId, string>>(
    new Map(),
  );
  const [deletedIds, setDeletedIds] = useState<Set<JanusId>>(new Set());
  const me = adapter.account.isGuest ? null : adapter.account.username;

  // --- Power pack: new-since-last-visit, user tags, find-in-thread ---------
  // Record this open and learn when we were last here; comments newer than
  // that get the NEW treatment. Works identically on Reddit and Lemmy —
  // visits key on JanusIds.
  const [prevVisit, setPrevVisit] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void initThreadVisits().then(() => {
      if (!alive) return;
      const prev = recordVisit(post);
      setPrevVisit(prev ? prev.lastVisit : null);
    });
    return () => {
      alive = false;
    };
  }, [post.id]);

  // RES-style user tags (handle-keyed, so they follow users on both networks).
  const [tagsVersion, setTagsVersion] = useState(0);
  useEffect(() => {
    void initUserTags().then(() => setTagsVersion((v) => v + 1));
  }, []);
  const [tagTarget, setTagTarget] = useState<string | null>(null);

  // Read Later — local, account-free queue (works signed-out, both networks).
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    let alive = true;
    void initReadLater().then(() => {
      if (alive) setQueued(isReadLater(post.id));
    });
    return () => {
      alive = false;
    };
  }, [post.id]);
  const onToggleReadLater = () => {
    const next = toggleReadLater(post);
    setQueued(next);
    setToast(next ? "Added to Read Later" : "Removed from Read Later");
  };
  const saveTag = (handle: string, tag: { label: string; color: string } | null) => {
    if (tag) setUserTag(handle, tag);
    else removeUserTag(handle);
    setTagsVersion((v) => v + 1);
  };

  // Find-in-thread: substring search across the rendered comment rows.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => findThreadMatches(visible, query),
    [visible, query],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const [matchCursor, setMatchCursor] = useState(0);
  useEffect(() => setMatchCursor(0), [query]);
  const gotoMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchCursor + dir + matches.length) % matches.length;
    setMatchCursor(next);
    listRef.current?.scrollToIndex({
      index: matches[next],
      animated: true,
      viewPosition: 0.2,
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  // A comment is NEW if it postdates your last visit OR arrived via live mode.
  const commentIsNew = useCallback(
    (c: Comment) =>
      isNewComment(c, prevVisit, me) || liveNewIds.has(c.id as string),
    [prevVisit, me, liveNewIds],
  );

  // NEW-comment jump: cycle through comments that landed since the last visit.
  const newIndices = useMemo(
    () =>
      visible.flatMap((v, i) =>
        !v.loadMore && commentIsNew(v.comment) ? [i] : [],
      ),
    [visible, commentIsNew],
  );
  const newCursor = useRef(-1);
  const jumpToNextNew = () => {
    if (newIndices.length === 0) return;
    newCursor.current = (newCursor.current + 1) % newIndices.length;
    listRef.current?.scrollToIndex({
      index: newIndices[newCursor.current],
      animated: true,
      viewPosition: 0.2,
    });
  };

  // --- Moderation (only when you moderate this post's community) -------------
  const canModerate = post.canModerate && !!adapter.moderate;
  const [modSheet, setModSheet] = useState<ModMenuItem[] | null>(null);
  const [modTarget, setModTarget] = useState<JanusId | null>(null);
  const [postLocked, setPostLocked] = useState(
    post.interactionStatus === "locked",
  );
  const [postPinned, setPostPinned] = useState(post.isStickied);
  const [postRemoved, setPostRemoved] = useState(post.isRemoved);
  const [removedComments, setRemovedComments] = useState<Set<JanusId>>(
    new Set(),
  );

  const runMod = async (target: JanusId, action: ModAction) => {
    try {
      await adapter.moderate!(target, action);
      if (target === post.id) {
        if (action.kind === "remove") setPostRemoved(true);
        else if (action.kind === "approve") setPostRemoved(false);
        else if (action.kind === "lock") setPostLocked(action.locked);
        else if (action.kind === "pin") setPostPinned(action.pinned);
      } else if (action.kind === "remove") {
        setRemovedComments((p) => new Set(p).add(target));
      } else if (action.kind === "approve") {
        setRemovedComments((p) => {
          const n = new Set(p);
          n.delete(target);
          return n;
        });
      }
      setToast("Done");
    } catch {
      setToast("Action failed — are you still a mod here?");
    }
  };

  const openPostMod = () => {
    setModTarget(post.id);
    setModSheet([
      postRemoved
        ? {
            label: "Approve",
            icon: "checkmark-circle-outline",
            action: { kind: "approve" },
          }
        : {
            label: "Remove",
            icon: "close-circle-outline",
            action: { kind: "remove" },
            destructive: true,
          },
      {
        label: postLocked ? "Unlock comments" : "Lock comments",
        icon: postLocked ? "lock-open-outline" : "lock-closed-outline",
        action: { kind: "lock", locked: !postLocked },
      },
      {
        label: postPinned ? "Unpin" : "Pin",
        icon: "pin-outline",
        action: { kind: "pin", pinned: !postPinned },
      },
    ]);
  };

  const openCommentMod = (comment: Comment) => {
    const removed = removedComments.has(comment.id);
    setModTarget(comment.id);
    setModSheet([
      removed
        ? {
            label: "Approve",
            icon: "checkmark-circle-outline",
            action: { kind: "approve" },
          }
        : {
            label: "Remove",
            icon: "close-circle-outline",
            action: { kind: "remove" },
            destructive: true,
          },
      {
        label:
          comment.distinguished === "moderator"
            ? "Undistinguish"
            : "Distinguish as mod",
        icon: "shield-checkmark-outline",
        action: {
          kind: "distinguish",
          distinguished: comment.distinguished !== "moderator",
        },
      },
    ]);
  };

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
    if (next !== 0 && next !== prevVote)
      void bumpUsage("votesCast", Date.now());
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

  // Per-comment optimistic vote state, keyed by comment id.
  const [commentVotes, setCommentVotes] = useState<
    Map<JanusId, { vote: Vote; score: number }>
  >(new Map());
  const commentVotesRef = useRef(commentVotes);
  commentVotesRef.current = commentVotes;
  const onCommentVote = useCallback(
    (comment: Comment, next: Vote) => {
      if (adapter.account.isGuest) {
        setToast("Sign in to vote");
        return;
      }
      const cur = commentVotesRef.current.get(comment.id) ?? {
        vote: comment.userVote,
        score: comment.score,
      };
      const optimistic = { vote: next, score: cur.score + (next - cur.vote) };
      setCommentVotes((prev) => new Map(prev).set(comment.id, optimistic));
      adapter.vote(comment.id, next).catch(() => {
        setCommentVotes((prev) => new Map(prev).set(comment.id, cur));
        setToast("Couldn't vote — try again");
      });
    },
    [adapter],
  );

  // Swipe-to-vote / save on comments (toggles, optimistic).
  const swipeVoteComment = (comment: Comment, target: Vote) => {
    const cur =
      commentVotesRef.current.get(comment.id)?.vote ?? comment.userVote;
    onCommentVote(comment, cur === target ? Vote.None : target);
  };
  const [savedComments, setSavedComments] = useState<Set<JanusId>>(new Set());
  const swipeSaveComment = (comment: Comment) => {
    if (adapter.account.isGuest) {
      setToast("Sign in to save");
      return;
    }
    const isSaved = savedComments.has(comment.id) || comment.saved;
    const next = !isSaved;
    setSavedComments((prev) => {
      const s = new Set(prev);
      if (next) s.add(comment.id);
      else s.delete(comment.id);
      return s;
    });
    adapter
      .save(comment.id, next)
      .then(() => setToast(next ? "Saved" : "Unsaved"))
      .catch(() => {
        setSavedComments((prev) => {
          const s = new Set(prev);
          if (next) s.delete(comment.id);
          else s.add(comment.id);
          return s;
        });
        setToast("Couldn't save — try again");
      });
  };

  const startReply = (target?: Comment) => {
    if (adapter.account.isGuest) {
      setToast("Sign in to comment");
      return;
    }
    setComposer({
      mode: "reply",
      targetId: target?.id ?? post.id,
      label: target ? `Replying to ${target.author.handle}` : "Add a comment",
      initial: "",
    });
  };

  const startEditComment = (comment: Comment) => {
    setComposer({
      mode: "edit",
      targetId: comment.id,
      label: "Edit comment",
      initial: editedBodies.get(comment.id) ?? comment.body.text ?? "",
    });
  };

  const submitComposer = async (markdown: string) => {
    if (!composer || submitting) return;
    setSubmitting(true);
    try {
      if (composer.mode === "reply") {
        const created = await adapter.submitComment({
          postId: post.id,
          parentId: composer.targetId,
          markdown,
        });
        setExtraComments((prev) => [...prev, created]);
        void bumpUsage("commentsPosted", Date.now());
        setToast("Comment posted");
      } else {
        await adapter.editContent(composer.targetId, markdown);
        const targetId = composer.targetId;
        if (targetId === post.id) setPostBody(markdown);
        else setEditedBodies((prev) => new Map(prev).set(targetId, markdown));
        setToast(targetId === post.id ? "Post edited" : "Comment edited");
      }
      setComposer(null);
    } catch (e) {
      setToast(
        e instanceof NotAuthenticatedError
          ? "Sign in to comment"
          : "Couldn't save — try again",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const deleteComment = (comment: Comment) => {
    Alert.alert("Delete comment", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletedIds((prev) => new Set(prev).add(comment.id));
          try {
            await adapter.deleteContent(comment.id);
          } catch {
            setDeletedIds((prev) => {
              const next = new Set(prev);
              next.delete(comment.id);
              return next;
            });
            setToast("Couldn't delete — try again");
          }
        },
      },
    ]);
  };

  const isOwnPost = !!me && post.author.username === me;
  const startEditPost = () =>
    setComposer({
      mode: "edit",
      targetId: post.id,
      label: "Edit post",
      initial: postBody ?? "",
    });
  const deletePost = () => {
    Alert.alert("Delete post", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await adapter.deleteContent(post.id);
            navigation.goBack();
          } catch {
            setToast("Couldn't delete — try again");
          }
        },
      },
    ]);
  };

  const cycleCommentSort = () => {
    const i = commentSorts.findIndex((s) => s.id === commentSort);
    const next = commentSorts[(i + 1) % commentSorts.length];
    if (next) {
      setCommentSort(next.id);
      if (settings.rememberCommunitySort) {
        void setCommunitySort(post.community.id, "comment", next.id);
      }
    }
  };

  const sharePost = async () => {
    const url = postShareUrl(post);
    try {
      await Share.share({ url, message: `${post.title}\n${url}` });
    } catch {
      /* user dismissed the share sheet */
    }
  };

  // Reporting — available to signed-in users on content they don't own.
  const canReport = !!me && !!adapter.reportContent;
  const reportResult = (ok: boolean) =>
    setToast(ok ? "Reported to moderators" : "Couldn't report — try again");
  const reportPost = () =>
    promptReport(
      "post",
      (reason) => adapter.reportContent!(post.id, reason),
      reportResult,
    );
  const reportComment = (comment: Comment) =>
    promptReport(
      "comment",
      (reason) => adapter.reportContent!(comment.id, reason),
      reportResult,
    );

  const image = post.media.find(
    (m) => m.kind === "image" || m.kind === "gallery",
  );
  const imageUri = isHttpUrl(image?.url)
    ? image!.url
    : isHttpUrl(image?.thumbnailUrl)
      ? image!.thumbnailUrl
      : undefined;
  const obscured = post.isNSFW || post.isSpoiler;
  const crossPost =
    post.ext.source === "reddit" ? post.ext.crossPost : undefined;
  const video = post.media.find((m) => m.kind === "video");
  const videoUri = video
    ? isHttpUrl(video.hlsUrl)
      ? video.hlsUrl
      : isHttpUrl(video.url)
        ? video.url
        : undefined
    : undefined;
  const galleryImages = post.media
    .filter((m) => m.kind === "image" || m.kind === "gallery")
    .map((m) => (isHttpUrl(m.url) ? m.url : m.thumbnailUrl))
    .filter((u): u is string => isHttpUrl(u));
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
        <Pressable
          onPress={() =>
            navigation.navigate("Profile", {
              userId: post.author.id,
              source: post.source,
              handle: post.author.handle,
            })
          }
          onLongPress={() => setTagTarget(post.author.handle)}
          accessibilityRole="button"
          accessibilityLabel={`View ${post.author.handle}'s profile. Long-press to tag.`}
          hitSlop={6}
          style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}
        >
          <Text
            style={[t.type.small, { color: t.colors.accent, flexShrink: 1 }]}
            numberOfLines={1}
          >
            by {post.author.handle}
          </Text>
          {(() => {
            const tag = tagsVersion >= 0 ? getUserTag(post.author.handle) : undefined;
            return tag ? (
              <Text
                style={[
                  styles.authorTag,
                  { color: tag.color, borderColor: tag.color },
                ]}
                numberOfLines={1}
              >
                {tag.label}
              </Text>
            ) : null;
          })()}
        </Pressable>

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

        {videoUri ? (
          <View style={{ marginTop: t.spacing.md }}>
            <InlineVideo
              uri={videoUri}
              poster={imageUri ?? video?.thumbnailUrl}
              aspectRatio={video?.aspectRatio ?? 1.4}
              obscured={obscured}
              obscureLabel={post.isNSFW ? "NSFW" : "SPOILER"}
            />
          </View>
        ) : imageUri ? (
          <Pressable
            onPress={() =>
              navigation.navigate("ImageViewer", {
                images: galleryImages.length ? galleryImages : [imageUri],
                index: 0,
              })
            }
            accessibilityRole="imagebutton"
            accessibilityLabel="View image"
            style={{ marginTop: t.spacing.md }}
          >
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
          </Pressable>
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

        {postBody?.trim() ? (
          <View style={{ marginTop: t.spacing.md }}>
            <CollapsibleBody>
              <Markdown source={postBody} />
            </CollapsibleBody>
          </View>
        ) : null}

        {post.poll ? <PollView poll={post.poll} /> : null}

        {crossPost ? (
          <CrosspostCard
            post={crossPost}
            onPress={() => navigation.push("Post", { post: crossPost })}
          />
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
            allowDownvote={allowDownvote}
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
          {postBody?.trim() ? (
            <Pressable
              onPress={() => setSelectText(postBody)}
              accessibilityRole="button"
              accessibilityLabel="Select text"
              hitSlop={8}
              style={[styles.stat, { marginRight: t.spacing.lg }]}
            >
              <Ionicons
                name="text-outline"
                size={16}
                color={t.colors.textSecondary}
              />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onToggleReadLater}
            accessibilityRole="button"
            accessibilityLabel={
              queued ? "Remove from Read Later" : "Read later"
            }
            accessibilityState={{ selected: queued }}
            hitSlop={8}
            style={[styles.stat, { marginRight: t.spacing.lg }]}
          >
            <Ionicons
              name={queued ? "time" : "time-outline"}
              size={16}
              color={queued ? t.colors.accent : t.colors.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={sharePost}
            accessibilityRole="button"
            accessibilityLabel="Share post"
            hitSlop={8}
            style={[styles.stat, { marginRight: t.spacing.lg }]}
          >
            <Ionicons
              name="share-outline"
              size={16}
              color={t.colors.textSecondary}
            />
          </Pressable>
          {canReport && !isOwnPost ? (
            <Pressable
              onPress={reportPost}
              accessibilityRole="button"
              accessibilityLabel="Report post"
              hitSlop={8}
              style={[styles.stat, { marginRight: t.spacing.lg }]}
            >
              <Ionicons
                name="flag-outline"
                size={16}
                color={t.colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {canModerate ? (
            <Pressable
              onPress={openPostMod}
              accessibilityRole="button"
              accessibilityLabel="Moderate post"
              hitSlop={8}
              style={[styles.stat, { marginRight: t.spacing.lg }]}
            >
              <Ionicons
                name="shield-outline"
                size={16}
                color={t.colors.accent}
              />
            </Pressable>
          ) : null}
          {isOwnPost ? (
            <>
              <Pressable
                onPress={startEditPost}
                accessibilityRole="button"
                accessibilityLabel="Edit post"
                hitSlop={8}
                style={[styles.stat, { marginRight: t.spacing.lg }]}
              >
                <Ionicons
                  name="create-outline"
                  size={16}
                  color={t.colors.textSecondary}
                />
              </Pressable>
              <Pressable
                onPress={deletePost}
                accessibilityRole="button"
                accessibilityLabel="Delete post"
                hitSlop={8}
                style={[styles.stat, { marginRight: t.spacing.lg }]}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={t.colors.danger}
                />
              </Pressable>
            </>
          ) : null}
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
        <Text style={[t.type.meta, { color: t.colors.textSecondary, flex: 1 }]}>
          {compactNumber(post.commentCount)} comments
        </Text>
        {newIndices.length > 0 ? (
          <Pressable
            onPress={jumpToNextNew}
            accessibilityRole="button"
            accessibilityLabel={`${newIndices.length} new comments since your last visit. Tap to jump to the next one.`}
            hitSlop={8}
            style={[
              styles.newPill,
              { backgroundColor: t.colors.accent, borderRadius: t.radius.pill },
            ]}
          >
            <Text style={[t.type.small, { color: "#fff", fontWeight: "700" }]}>
              {newIndices.length} new ↓
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setLive((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            live
              ? "Live mode on — comments refresh automatically. Tap to stop."
              : "Live mode — refresh comments automatically"
          }
          accessibilityState={{ selected: live }}
          hitSlop={8}
          style={[
            styles.livePill,
            live && {
              backgroundColor: t.colors.accent,
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Ionicons
            name="radio-outline"
            size={14}
            color={live ? "#fff" : t.colors.textSecondary}
          />
          {live ? (
            <Text
              style={[
                t.type.small,
                { color: "#fff", fontWeight: "700", marginLeft: 4 },
              ]}
            >
              LIVE
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          accessibilityRole="button"
          accessibilityLabel="Search comments"
          hitSlop={8}
          style={{ marginRight: 14 }}
        >
          <Ionicons
            name="search"
            size={15}
            color={searchOpen ? t.colors.accent : t.colors.textSecondary}
          />
        </Pressable>
        {commentSorts.length > 1 ? (
          <Pressable
            onPress={cycleCommentSort}
            accessibilityRole="button"
            accessibilityLabel={`Sort comments by ${commentSorts.find((s) => s.id === commentSort)?.label ?? commentSort}. Tap to change.`}
            hitSlop={8}
            style={styles.sortBtn}
          >
            <Ionicons name="swap-vertical" size={14} color={t.colors.accent} />
            <Text
              style={[
                t.type.meta,
                { color: t.colors.accent, marginLeft: 5, fontWeight: "600" },
              ]}
            >
              {commentSorts.find((s) => s.id === commentSort)?.label ?? "Sort"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {searchOpen ? (
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: t.colors.bgElevated,
              borderBottomColor: t.colors.border,
              paddingHorizontal: t.spacing.lg,
            },
          ]}
        >
          <Ionicons name="search" size={15} color={t.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find in thread…"
            placeholderTextColor={t.colors.textTertiary}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => gotoMatch(1)}
            accessibilityLabel="Find in thread"
            style={[
              t.type.meta,
              styles.searchInput,
              { color: t.colors.text },
            ]}
          />
          <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
            {matches.length === 0
              ? query.trim().length >= 2
                ? "0"
                : ""
              : `${matchCursor + 1}/${matches.length}`}
          </Text>
          <Pressable
            onPress={() => gotoMatch(-1)}
            disabled={matches.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Previous match"
            hitSlop={8}
            style={{ marginLeft: 12 }}
          >
            <Ionicons
              name="chevron-up"
              size={18}
              color={
                matches.length ? t.colors.accent : t.colors.textTertiary
              }
            />
          </Pressable>
          <Pressable
            onPress={() => gotoMatch(1)}
            disabled={matches.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Next match"
            hitSlop={8}
            style={{ marginLeft: 12 }}
          >
            <Ionicons
              name="chevron-down"
              size={18}
              color={
                matches.length ? t.colors.accent : t.colors.textTertiary
              }
            />
          </Pressable>
          <Pressable
            onPress={closeSearch}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={8}
            style={{ marginLeft: 12 }}
          >
            <Ionicons name="close" size={18} color={t.colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <FlashList
        ref={listRef}
        data={visible}
        keyExtractor={(v) =>
          v.loadMore ? `more:${v.comment.id}` : v.comment.id
        }
        extraData={`${commentVotes.size}-${editedBodies.size}-${deletedIds.size}-${loadingMore.size}-${savedComments.size}-${tagsVersion}-${prevVisit ?? 0}-${query}-${matchCursor}-${liveNewIds.size}`}
        renderItem={({ item, index }) =>
          item.loadMore ? (
            <LoadMoreRow
              item={item}
              busy={loadingMore.has(item.comment.id)}
              onPress={() => onLoadMore(item.comment, item.loadMore!)}
            />
          ) : (
            <SwipeableVoteRow
              enabled={
                !adapter.account.isGuest && !deletedIds.has(item.comment.id)
              }
              allowDownvote={allowDownvote}
              userVote={
                commentVotes.get(item.comment.id)?.vote ?? item.comment.userVote
              }
              saved={savedComments.has(item.comment.id) || item.comment.saved}
              config={settings.swipe}
              haptics={settings.haptics}
              edgeBackInset={32}
              onUpvote={() => swipeVoteComment(item.comment, Vote.Up)}
              onDownvote={() => swipeVoteComment(item.comment, Vote.Down)}
              onSave={() => swipeSaveComment(item.comment)}
            >
              <CommentItem
                item={item}
                onToggle={toggle}
                onReply={startReply}
                onVote={onCommentVote}
                voteState={commentVotes.get(item.comment.id)}
                allowDownvote={allowDownvote}
                onEdit={
                  me && item.comment.author.username === me
                    ? startEditComment
                    : undefined
                }
                onDelete={
                  me && item.comment.author.username === me
                    ? deleteComment
                    : undefined
                }
                onModerate={canModerate ? openCommentMod : undefined}
                onReport={
                  canReport && item.comment.author.username !== me
                    ? reportComment
                    : undefined
                }
                bodyOverride={
                  removedComments.has(item.comment.id)
                    ? "*[removed by a moderator]*"
                    : editedBodies.get(item.comment.id)
                }
                deleted={deletedIds.has(item.comment.id)}
                isNew={commentIsNew(item.comment)}
                searchHit={matchSet.has(index)}
                tag={getUserTag(item.comment.author.handle)}
                onAuthorPress={(c) =>
                  navigation.navigate("Profile", {
                    userId: c.author.id,
                    source: post.source,
                    handle: c.author.handle,
                  })
                }
                onAuthorLongPress={(c) => setTagTarget(c.author.handle)}
              />
            </SwipeableVoteRow>
          )
        }
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
            onRefresh={() => {
              // A manual refresh supersedes the live snapshot.
              setLiveComments(null);
              setLiveNewIds(new Set());
              comments.reload();
            }}
            tintColor={t.colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      />
      {rootIndices.length > 1 ? (
        <Pressable
          onPress={scrollToNextComment}
          accessibilityRole="button"
          accessibilityLabel="Jump to next comment"
          style={[
            styles.nextCommentFab,
            {
              backgroundColor: t.colors.accentActive,
              bottom: insets.bottom + 24,
            },
          ]}
        >
          <Ionicons name="chevron-down" size={22} color="#fff" />
        </Pressable>
      ) : null}
      <SelectTextModal
        visible={selectText !== null}
        text={selectText ?? ""}
        onClose={() => setSelectText(null)}
      />
      {tagTarget ? (
        <UserTagEditor
          visible
          handle={tagTarget}
          current={getUserTag(tagTarget)}
          onSave={(tag) => saveTag(tagTarget, tag)}
          onClose={() => setTagTarget(null)}
        />
      ) : null}
      <ModActionSheet
        visible={modSheet !== null}
        title={modTarget === post.id ? "Moderate post" : "Moderate comment"}
        items={modSheet ?? []}
        onSelect={(action) => {
          if (modTarget) void runMod(modTarget, action);
        }}
        onClose={() => setModSheet(null)}
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
      {composer ? (
        <CommentComposer
          contextLabel={composer.label}
          submitting={submitting}
          initialText={composer.initial}
          submitLabel={composer.mode === "edit" ? "Save" : "Post"}
          source={post.source}
          customEmojis={customEmojis.data ?? undefined}
          popularEmoji={popularEmojiFor(adapter.instance)}
          emojiInstance={adapter.instance}
          onSubmit={submitComposer}
          onCancel={() => setComposer(null)}
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
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sortBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 2 },
  newPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginRight: 14,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 10,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, marginLeft: 8, paddingVertical: 2 },
  authorTag: {
    marginLeft: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    fontSize: 10,
    fontWeight: "700",
    overflow: "hidden",
    flexShrink: 1,
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
  nextCommentFab: {
    position: "absolute",
    right: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
});
