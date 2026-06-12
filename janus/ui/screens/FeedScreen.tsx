import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useFeed, useOffline } from "../hooks";
import { isOffline } from "../../app/offline";
import { aiLensStatus } from "../../app/aiLensService";
import { aiQueue } from "../../app/aiLensQueue";
import { cachedVerdict, type AiVerdict } from "../../app/aiLens";
import { getAiLensPolicy } from "../../app/aiLensPolicy";
import { getPangramState } from "../../app/pangramModel";
import { resolveCommentSort } from "../../app/commentSortResolve";
import { createAiPrefetcher, MIN_BODY_CHARS } from "../aiPrefetch";
import {
  clearApprovalReminder,
  maybeCheckApproval,
} from "../../app/aiLensReminder";
import { enqueueVote, drainOutbox, outboxCount } from "../../app/outbox";
import { packedFeedPage } from "../../app/offlinePack";
import { hasSeenHint, markHintSeen } from "../../app/hints";
import { resolveCommunityRef } from "../communityNav";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { PostScreen } from "./PostScreen";
import { GalleryGrid } from "../components/GalleryGrid";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { InboxButton } from "../components/InboxButton";
import { createAggregateFeed, UNIFIED_FEED_SORTS } from "../unifiedFeed";
import { buildAggregateSpecs, type FeedMode } from "../feedSources";
import { createGroupFeed } from "../groupFeed";
import type { FeedGroup } from "../../app/feedGroups";
import {
  recordCommunityVisit,
  type CommunityVisit,
} from "../../app/communityAffinity";
import { getCommunitySort, setCommunitySort } from "../../app/communityPrefs";
import { initSeenPosts, isSeen, markSeen } from "../../app/seenPosts";
import { initThreadVisits } from "../../app/threadVisits";
import {
  initReadLater,
  isReadLater,
  toggleReadLater,
  readLaterCount,
} from "../../app/readLater";
import {
  initThreadSeries,
  isFollowedSeries,
  followSeries,
  unfollowSeries,
  seriesForCommunity,
  titleMatchesSeries,
  looksLikeRecurringTitle,
  type FollowedSeries,
} from "../../app/threadSeries";
import { topFlairs, filterByFlair } from "../flairFilter";
import { bumpUsage } from "../../app/usageStats";
import {
  collapseCrossposts,
  type FeedEntry,
} from "../../app/crosspostCollapse";
import { CommunityPicker } from "../components/CommunityPicker";
import { CommunityDrawer } from "../components/CommunityDrawer";
import { SwipeableVoteRow } from "../components/SwipeableVoteRow";
import { ActionSheet, type ActionItem } from "../components/ActionSheet";
import { applyVote } from "../swipeVote";
import { useSettings } from "../SettingsContext";
import { filterPosts } from "../postFilters";
import { postShareUrl } from "../links";
import { promptReport } from "../reportFlow";
import { Vote } from "../../core/vote";
import { GatedContentError, isConnectivityError } from "../../core/errors";
import type { SourceAdapter } from "../../core/adapter";
import type { Post, Community, Multireddit } from "../../core/model";
import type { TimeWindow, SortOption } from "../../core/capabilities";

interface VoteOverlay {
  userVote: Vote;
  score: number;
  saved: boolean;
}

const MODE_LABELS: Record<FeedMode, string> = {
  subscribed: "Subscribed",
  all: "All",
  local: "Local",
};

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;
type ViewMode = "list" | "gallery";
type Density = "compact" | "comfortable";

export function FeedScreen({ navigation, route }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings, set } = useSettings();
  // iPad/wide: feed list on the left, the selected post in a detail pane.
  const splitView = width >= 720 && settings.splitView;
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const {
    manager,
    adapters,
    feedScope,
    setFeedScope,
    accountVersion,
    lemmyAdapters,
    adapterForEntity,
    groups,
  } = useAdapters();

  const [community, setCommunity] = useState<Community | null>(null);
  const [multi, setMulti] = useState<Multireddit | null>(null);
  const [group, setGroup] = useState<FeedGroup | null>(null);
  const [mode, setMode] = useState<FeedMode>(settings.defaultFeed);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [density, setDensity] = useState<Density>(
    settings.postLayout === "comfortable" ? "comfortable" : "compact",
  );
  // Optimistic swipe-vote/save state, keyed by post id.
  const [voteOverlay, setVoteOverlay] = useState<Record<string, VoteOverlay>>(
    {},
  );
  // Per-instance downvote permission (Hexbear disables them); default allow.
  const [downvotesByKey, setDownvotesByKey] = useState<Record<string, boolean>>(
    {},
  );

  // A community pins the feed to its OWN instance's adapter — routed by origin,
  // so a hexbear community hits hexbear even while lemmy.ml is focused.
  const communityAdapter = community ? adapterForEntity(community) : null;

  // The adapter pool the current scope fans out over (when not community-scoped):
  // one Reddit + every Lemmy instance, or a single source.
  const pool: SourceAdapter[] = useMemo(() => {
    if (feedScope === "reddit") return [adapters.reddit];
    if (feedScope === "lemmy") return lemmyAdapters;
    return [adapters.reddit, ...lemmyAdapters];
  }, [feedScope, adapters.reddit, lemmyAdapters]);

  const hasLemmy = pool.some((a) => a.source === "lemmy");
  const signedIn = pool.filter((a) => !a.account.isGuest);
  // The account whose profile/saved the drawer opens — prefer one in the active
  // pool, falling back to any signed-in identity.
  const ownAccount = (signedIn[0] ?? manager.signedInAdapters()[0])?.account;
  // Subscribed needs an account; Local needs Lemmy. Fall back to "All" so the
  // feed is never inexplicably blank.
  const effectiveMode: FeedMode =
    mode === "subscribed" && signedIn.length === 0
      ? "all"
      : mode === "local" && !hasLemmy
        ? "all"
        : mode;
  const activePool = effectiveMode === "subscribed" ? signedIn : pool;
  const multiOrigin = activePool.length > 1;
  const mixed =
    activePool.some((a) => a.source === "reddit") &&
    activePool.some((a) => a.source === "lemmy");

  const feedSorts: readonly SortOption[] = community
    ? communityAdapter!.capabilities.sorts.feed
    : multi
      ? adapters.reddit.capabilities.sorts.feed
      : group || mixed || activePool.length === 0
        ? UNIFIED_FEED_SORTS
        : activePool[0].capabilities.sorts.feed;
  // Honour the user's default sort when the current context supports it, else
  // fall back to the first available — so "default sort = Top" applies to both
  // sources without forking.
  const resolveSort = (opts: readonly SortOption[]): string =>
    opts.find((s) => s.id === settings.defaultPostSort)?.id ??
    opts[0]?.id ??
    "hot";
  const [sort, setSort] = useState<string>(() => resolveSort(feedSorts));

  // When the scope/mode/community changes, the available sorts change too. For a
  // community we honour its remembered sort (if enabled); otherwise snap back to
  // the user's default (or the first valid sort).
  useEffect(() => {
    let alive = true;
    if (community && settings.rememberCommunitySort) {
      void getCommunitySort(community.id, "post").then((saved) => {
        if (!alive) return;
        setSort(
          saved && feedSorts.some((s) => s.id === saved)
            ? saved
            : resolveSort(feedSorts),
        );
      });
    } else {
      setSort(resolveSort(feedSorts));
    }
    return () => {
      alive = false;
    };
  }, [
    feedScope,
    effectiveMode,
    community?.id,
    multi?.id,
    group?.id,
    settings.defaultPostSort,
    settings.rememberCommunitySort,
  ]);

  // Persist a community sort choice so it sticks next time you open it.
  const chooseSort = (id: string) => {
    setSort(id);
    if (community && settings.rememberCommunitySort) {
      void setCommunitySort(community.id, "post", id);
    }
  };

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow
    ? settings.topTimeWindow
    : undefined;

  // Pool identity in the deps so the feed rebuilds when accounts/instances change.
  const poolKey = activePool.map((a) => `${a.source}:${a.instance}`).join(",");
  // Offline = the pack IS the feed: same cards, same gallery mode, same repost
  // collapse — just paged from disk. Flipping back online refetches live.
  const offline = useOffline();
  // Feed-blend weights — only bites when the pool actually mixes Reddit + Lemmy.
  const mixWeight = (source: SourceAdapter["source"]): number => {
    if (settings.feedMix === "reddit") return source === "reddit" ? 3 : 1;
    if (settings.feedMix === "lemmy") return source === "lemmy" ? 3 : 1;
    return 1;
  };
  const feed = useFeed<Post>(
    offline
      ? (page) => Promise.resolve(packedFeedPage(page, community?.id))
      : community
        ? (page) =>
            communityAdapter!.getFeed(
              { communityId: community.id, sort, timeWindow },
              page,
            )
        : multi
          ? (page) =>
              adapters.reddit.getFeed(
                { multiId: multi.id, sort, timeWindow },
                page,
              )
          : group
            ? createGroupFeed(manager, group.members, { sort, timeWindow })
            : (() => {
                const specs = buildAggregateSpecs(activePool, effectiveMode, {
                  sort,
                  timeWindow,
                });
                const weights =
                  mixed && settings.feedMix !== "balanced"
                    ? specs.map((s) => mixWeight(s.adapter.source))
                    : undefined;
                return createAggregateFeed(specs, weights);
              })(),
    [
      feedScope,
      effectiveMode,
      sort,
      accountVersion,
      community?.id,
      multi?.id,
      group?.id,
      poolKey,
      settings.feedMix,
      offline,
    ],
  );

  const targetLabel = community
    ? community.handle
    : multi
      ? multi.name
      : group
        ? group.name
        : MODE_LABELS[effectiveMode];
  const sourceLabel = community
    ? community.source === "reddit"
      ? "Reddit"
      : communityAdapter!.instance
    : multi
      ? `Multireddit · ${multi.communities.length} subs`
      : group
        ? `${group.members.length} communities`
        : mixed
          ? "Reddit + Lemmy"
          : multiOrigin
            ? `${activePool.length} Lemmy instances`
            : (activePool[0]?.instance ?? "Feed");

  // Follow state for the currently-viewed community (optimistic).
  const [following, setFollowing] = useState(false);
  const followBusy = useRef(false);
  useEffect(() => {
    setFollowing(community?.subscription === "subscribed");
  }, [community?.id, community?.subscription]);
  const canFollow = !!community && !communityAdapter!.account.isGuest;
  const toggleFollow = async () => {
    if (!community || followBusy.current) return;
    followBusy.current = true;
    const next = !following;
    setFollowing(next);
    try {
      await communityAdapter!.setSubscription(community.id, next);
    } catch {
      setFollowing(!next);
    } finally {
      followBusy.current = false;
    }
  };

  // Probe each pooled adapter once for whether downvotes are enabled there.
  useEffect(() => {
    let cancelled = false;
    for (const a of activePool) {
      const key = `${a.source}:${a.instance}`;
      if (key in downvotesByKey) continue;
      if (a.getDownvotesEnabled) {
        a.getDownvotesEnabled()
          .then((v) => {
            if (!cancelled) setDownvotesByKey((d) => ({ ...d, [key]: v }));
          })
          .catch(() => {});
      } else {
        setDownvotesByKey((d) => ({ ...d, [key]: true }));
      }
    }
    return () => {
      cancelled = true;
    };
  }, [poolKey]);

  // Load the on-device "seen" set once, so hide-seen can filter synchronously,
  // and thread visits so cards can badge "+N new comments" synchronously too.
  const [seenReady, setSeenReady] = useState(false);
  useEffect(() => {
    void initSeenPosts().then(() => setSeenReady(true));
    void initThreadVisits();
    void initReadLater();
    void initThreadSeries().then(() => setSeriesVersion((v) => v + 1));
  }, []);

  // Flair browsing — chips appear on community feeds whose posts carry flair
  // (data-driven: Lemmy has none, so the row never shows there).
  const [activeFlair, setActiveFlair] = useState<string | null>(null);
  useEffect(() => setActiveFlair(null), [community?.id]);
  const flairChips = useMemo(
    () => (community ? topFlairs(feed.items) : []),
    [community?.id, feed.items],
  );

  // Followed thread series (megathread subs): the quick strip to today's
  // edition, shown when this community has followed series.
  const [seriesVersion, setSeriesVersion] = useState(0);
  const [openingSeries, setOpeningSeries] = useState<string | null>(null);
  const followedHere = useMemo(
    () => (community ? seriesForCommunity(community.id) : []),
    [community?.id, seriesVersion],
  );
  const openSeries = async (s: FollowedSeries) => {
    if (openingSeries) return;
    // Newest matching edition already in the loaded feed?
    const loaded = feed.items
      .filter((p) => titleMatchesSeries(p.title, s.seriesKey))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (loaded) {
      markSeen(loaded.id);
      openPost(loaded);
      return;
    }
    // Fall back to an in-community search, newest first — works on both
    // networks via the community's own adapter.
    setOpeningSeries(s.id);
    try {
      const adapter = communityAdapter ?? adapterForEntity(community!);
      const page = await adapter.search(s.label, "posts", {
        sort: adapter.source === "reddit" ? "new" : "New",
        communityId: community!.id,
      });
      const hit = (page.items as Post[])
        .filter((p) => "title" in p && titleMatchesSeries(p.title, s.seriesKey))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (hit) {
        markSeen(hit.id);
        openPost(hit);
      } else {
        Alert.alert(
          "Not found",
          "Couldn't find a recent edition of this series.",
        );
      }
    } catch {
      Alert.alert("Couldn't search", "Try again in a moment.");
    } finally {
      setOpeningSeries(null);
    }
  };

  // Apply the user's client-side filters (muted communities/users, keywords,
  // hide-NSFW, hide-seen) to the merged pool — one filter, both sources. Seen
  // posts are filtered only at (re)build time so a post you open doesn't vanish
  // mid-scroll; it's gone on the next refresh/load-more.
  const visibleItems = useMemo(() => {
    let filtered = filterPosts(feed.items, {
      filters: settings.filters,
      hideNsfw: settings.hideNsfw,
    });
    // Flair browsing: scope a community feed to one flair.
    if (community && activeFlair) {
      filtered = filterByFlair(filtered, activeFlair);
    }
    return settings.hideSeenPosts && seenReady
      ? filtered.filter((p) => !isSeen(p.id))
      : filtered;
  }, [
    feed.items,
    settings.filters,
    settings.hideNsfw,
    settings.hideSeenPosts,
    seenReady,
    community?.id,
    activeFlair,
  ]);

  // Fold same-content posts across communities/networks into one lead + its
  // companion discussions (the cross-network repost collapse).
  const feedEntries: FeedEntry[] = useMemo(
    () =>
      settings.collapseCrossNetwork
        ? collapseCrossposts(visibleItems)
        : visibleItems.map((post) => ({ post, companions: [] })),
    [visibleItems, settings.collapseCrossNetwork],
  );

  // AI Lens in the feed: judged posts wear a chip BEFORE you tap, and in
  // "ahead" mode each page is prefetched — post bodies plus the top comments
  // of the most-commented threads — so verdicts greet you from cache. All of
  // it rides the global inference queue at lowest priority; leaving the feed
  // sheds whatever hasn't run.
  const aiLensOn = aiLensStatus() === "ready";
  const aiPolicy = getAiLensPolicy();
  const aiAuto = aiPolicy.auto;
  const aiSha = getPangramState().sha;
  const [aiFeedTick, setAiFeedTick] = useState(0);
  useEffect(() => {
    if (!aiLensOn) return undefined;
    return aiQueue.subscribe(() => setAiFeedTick((v) => v + 1));
  }, [aiLensOn]);
  const aiFeedVerdicts = useMemo(() => {
    const map = new Map<string, AiVerdict>();
    if (!aiLensOn) return map;
    void aiFeedTick;
    for (const e of feedEntries) {
      const text = e.post.body?.text?.trim();
      if (!text) continue;
      const hit = cachedVerdict(text, aiSha);
      if (hit) map.set(e.post.id, hit);
    }
    return map;
  }, [aiLensOn, aiFeedTick, feedEntries, aiSha]);
  const aiPrefetcher = useMemo(
    () =>
      createAiPrefetcher({
        adapterForEntity,
        resolveSort: (adapter, communityId) =>
          resolveCommentSort({
            sorts: adapter.capabilities.sorts.comment,
            preferred: settings.defaultCommentSort,
            communityId,
            rememberCommunitySort: settings.rememberCommunitySort,
          }),
        queue: aiQueue,
        isOffline: () => isOffline(),
        modelSha: aiSha,
      }),
    [
      adapterForEntity,
      settings.defaultCommentSort,
      settings.rememberCommunitySort,
      aiSha,
    ],
  );
  useEffect(() => {
    if (!aiLensOn || aiAuto !== "ahead" || offline) return;
    void aiPrefetcher(feedEntries.map((e) => e.post));
  }, [aiLensOn, aiAuto, offline, feedEntries, aiPrefetcher]);
  useEffect(() => () => aiQueue.shedPrefetch(), []);

  const effectivePost = (p: Post): Post => {
    const o = voteOverlay[p.id];
    return o
      ? { ...p, userVote: o.userVote, score: o.score, saved: o.saved }
      : p;
  };

  const allowDownvote = (p: Post) =>
    downvotesByKey[`${p.source}:${p.instance}`] ?? true;

  // Plane mode: flush the outbox on reconnect.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (wasOffline.current && !offline) void drainOutbox(adapterForEntity);
    wasOffline.current = offline;
  }, [offline, adapterForEntity]);
  // Safety net for queued actions that never saw an offline->online flip
  // (a vote queued on a transient failure in a garage): drain on mount and
  // whenever the feed regains focus while connected.
  useEffect(() => {
    const tryDrain = () => {
      if (!isOffline() && outboxCount() > 0) void drainOutbox(adapterForEntity);
    };
    tryDrain();
    return navigation.addListener("focus", tryDrain);
  }, [navigation, adapterForEntity]);

  const swipeVotePost = (post: Post, target: Vote) => {
    const cur = voteOverlay[post.id] ?? {
      userVote: post.userVote,
      score: post.score,
      saved: post.saved,
    };
    const voted = applyVote(
      { userVote: cur.userVote, score: cur.score },
      target,
    );
    setVoteOverlay((o) => ({
      ...o,
      [post.id]: { ...voted, saved: cur.saved },
    }));
    // Offline: keep the optimistic state and queue the vote for landing.
    if (isOffline()) {
      enqueueVote(post.id, voted.userVote);
      return;
    }
    adapterForEntity(post)
      .vote(post.id, voted.userVote)
      .then((res) =>
        setVoteOverlay((o) => ({
          ...o,
          [post.id]: {
            userVote: res.userVote,
            score: res.score,
            saved: o[post.id]?.saved ?? post.saved,
          },
        })),
      )
      .catch((e) => {
        // Transient connectivity: keep the optimistic state, queue it.
        if (isConnectivityError(e)) {
          enqueueVote(post.id, voted.userVote);
          return;
        }
        setVoteOverlay((o) => {
          const next = { ...o };
          delete next[post.id];
          return next;
        });
      });
  };

  const swipeSavePost = (post: Post) => {
    const cur = voteOverlay[post.id];
    const wasSaved = cur?.saved ?? post.saved;
    const nextSaved = !wasSaved;
    setVoteOverlay((o) => ({
      ...o,
      [post.id]: {
        userVote: o[post.id]?.userVote ?? post.userVote,
        score: o[post.id]?.score ?? post.score,
        saved: nextSaved,
      },
    }));
    adapterForEntity(post)
      .save(post.id, nextSaved)
      .catch(() =>
        setVoteOverlay((o) => ({
          ...o,
          [post.id]: { ...o[post.id], saved: wasSaved },
        })),
      );
  };

  // Long-press context menu over a post.
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  // One-time teach: the long-press menu gates Read Later, series following...
  const [longPressTipSeen, setLongPressTipSeen] = useState(() =>
    hasSeenHint("feed.longPress"),
  );

  // AI Lens is the flagship — pitch it on first load, right in the feed,
  // until the user either sets it up or says no thanks. Auto-retires the
  // moment a model install exists in any phase.
  const [aiHeroSeen, setAiHeroSeen] = useState(() =>
    hasSeenHint("aiLens.hero"),
  );
  const showAiHero = !aiHeroSeen && getPangramState().phase === "none";

  // The approval-wait reminder: Pangram's gate takes days — when access
  // finally opens, say so right here instead of hoping they re-check.
  const [approvalReady, setApprovalReady] = useState(false);
  useEffect(() => {
    void maybeCheckApproval((url, init) => fetch(url, init)).then(
      setApprovalReady,
    );
  }, []);
  useEffect(() => {
    if (menuPost && !longPressTipSeen) {
      markHintSeen("feed.longPress");
      setLongPressTipSeen(true);
    }
  }, [menuPost, longPressTipSeen]);
  const muteCommunity = (p: Post) =>
    set({
      filters: {
        ...settings.filters,
        mutedCommunities: Array.from(
          new Set([...settings.filters.mutedCommunities, p.community.id]),
        ),
      },
    });
  const muteUser = (p: Post) =>
    set({
      filters: {
        ...settings.filters,
        mutedUsers: Array.from(
          new Set([...settings.filters.mutedUsers, p.author.id]),
        ),
      },
    });
  const menuItems = (p: Post): ActionItem[] => {
    const url = postShareUrl(p);
    const adapter = adapterForEntity(p);
    const signedIn = !adapter.account.isGuest;
    const items: ActionItem[] = [
      {
        label: "Share",
        icon: "share-outline",
        onPress: () =>
          void Share.share({ url, message: `${p.title}\n${url}` }).catch(
            () => {},
          ),
      },
      {
        label: "Copy link",
        icon: "link-outline",
        onPress: () => void Clipboard.setStringAsync(url),
      },
      {
        label: isReadLater(p.id) ? "Remove from Read Later" : "Read later",
        icon: isReadLater(p.id) ? "time" : "time-outline",
        onPress: () => void toggleReadLater(p),
      },
      // Megathread subs only: follow "Daily Question Thread"-style series.
      // Gated so one-off posts don't grow a meaningless follow action.
      ...(isFollowedSeries(p.community.id, p.title) ||
      looksLikeRecurringTitle(p.title)
        ? [
            {
              label: isFollowedSeries(p.community.id, p.title)
                ? "Unfollow thread series"
                : "Follow thread series",
              icon: "calendar-outline" as const,
              onPress: () => {
                if (isFollowedSeries(p.community.id, p.title)) {
                  unfollowSeries(p.community.id, p.title);
                } else {
                  followSeries(p);
                }
                setSeriesVersion((v) => v + 1);
              },
            },
          ]
        : []),
      {
        label: `Mute ${p.community.handle}`,
        icon: "eye-off-outline",
        onPress: () => muteCommunity(p),
      },
      {
        label: `Mute ${p.author.handle}`,
        icon: "person-remove-outline",
        onPress: () => muteUser(p),
      },
    ];
    if (
      p.source === "reddit" &&
      !adapters.reddit.account.isGuest &&
      adapters.reddit.addToMultireddit
    ) {
      items.push({
        label: "Add to multireddit",
        icon: "albums-outline",
        onPress: () => void openMultiPicker(p),
      });
    }
    if (signedIn && adapter.reportContent) {
      items.push({
        label: "Report",
        icon: "flag-outline",
        destructive: true,
        onPress: () =>
          promptReport("post", (reason) =>
            adapter.reportContent!(p.id, reason),
          ),
      });
    }
    return items;
  };

  // Second-stage sheet: pick which multireddit to add the post's community to.
  const [multiPick, setMultiPick] = useState<{
    title: string;
    items: ActionItem[];
  } | null>(null);
  const openMultiPicker = async (p: Post) => {
    const reddit = adapters.reddit;
    const multis = (await reddit.getMultireddits?.()) ?? [];
    const items: ActionItem[] = multis.map((m) => ({
      label: m.name,
      icon: "albums-outline",
      onPress: () => {
        void reddit.addToMultireddit?.(m.id, p.community.id);
      },
    }));
    setMultiPick({
      title: items.length
        ? `Add ${p.community.handle} to…`
        : "No multireddits yet — create one in the menu.",
      items,
    });
  };

  const openPost = (post: Post) => {
    // Pay attention to usage: every post you open counts toward its community.
    void recordCommunityVisit(
      {
        id: post.community.id,
        source: post.source,
        instance: post.instance,
        name: post.community.name,
        handle: post.community.handle,
        icon: post.community.icon,
      },
      Date.now(),
    );
    markSeen(post.id);
    void bumpUsage("postsOpened", Date.now());
    // In split view the post opens in the detail pane, not a pushed screen.
    if (splitView) setDetailPost(post);
    else navigation.navigate("Post", { post });
  };

  const recordCommunity = (c: Community) =>
    void recordCommunityVisit(
      {
        id: c.id,
        source: c.source,
        instance: c.instance,
        name: c.name,
        handle: c.handle,
        icon: c.icon,
      },
      Date.now(),
    );

  const selectCommunity = (sel: Community | null | "subscribed") => {
    setGroup(null); // community/subscribed selection clears any active group
    setMulti(null);
    if (sel === "subscribed") {
      setCommunity(null);
      setMode("subscribed");
    } else {
      if (sel) recordCommunity(sel);
      setCommunity(sel);
    }
    setPickerOpen(false);
  };

  const selectMulti = (m: Multireddit) => {
    setCommunity(null);
    setGroup(null);
    setMulti(m);
  };

  // Open a community handed in from search (navigation param), then clear the
  // param so a later back-nav/refresh doesn't re-open it.
  const openCommunity = route.params?.openCommunity;
  useEffect(() => {
    if (!openCommunity) return;
    selectCommunity(openCommunity);
    navigation.setParams({ openCommunity: undefined });
  }, [openCommunity]);

  // Auto-favorite tapped: reconstruct a routable community from the snapshot.
  const selectFavorite = (f: CommunityVisit) =>
    selectCommunity({
      id: f.id,
      source: f.source,
      instance: f.instance,
      name: f.name,
      handle: f.handle,
      icon: f.icon,
    } as unknown as Community);

  const selectGroup = (g: FeedGroup) => {
    setCommunity(null);
    setMulti(null);
    setGroup(g);
    setPickerOpen(false);
  };

  const appBar = (
    <SafeAreaView
      edges={["top"]}
      style={{ backgroundColor: t.colors.bgElevated }}
    >
      <View style={[styles.appBar, { borderBottomColor: t.colors.border }]}>
        <Pressable
          onPress={() => setDrawerOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          style={styles.barIcon}
        >
          <Ionicons name="menu" size={26} color={t.colors.text} />
        </Pressable>
        <Pressable
          onPress={() => setDrawerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open communities menu"
          style={styles.barTitle}
        >
          <Text
            style={[t.type.title, { color: t.colors.text, flexShrink: 1 }]}
            numberOfLines={1}
          >
            {targetLabel}
          </Text>
          <Ionicons
            name="chevron-down"
            size={15}
            color={t.colors.textSecondary}
            style={{ marginLeft: 4 }}
          />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate("Search")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Search"
          style={styles.barIcon}
        >
          <Ionicons name="search" size={22} color={t.colors.text} />
        </Pressable>
        <InboxButton onPress={() => navigation.navigate("Inbox")} />
      </View>
      {offline ? (
        <Pressable
          onPress={() => navigation.navigate("PlaneMode")}
          accessibilityRole="button"
          accessibilityLabel="Offline — open Plane Mode"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 6,
            backgroundColor: t.colors.bgElevated,
          }}
        >
          <Ionicons name="airplane" size={13} color={t.colors.accent} />
          <Text
            style={[
              t.type.small,
              { color: t.colors.textSecondary, marginHorizontal: 6 },
            ]}
          >
            Offline — reading from your pack
          </Text>
          <Ionicons
            name="chevron-forward"
            size={13}
            color={t.colors.textTertiary}
          />
        </Pressable>
      ) : null}
      {approvalReady ? (
        <Pressable
          onPress={() => {
            navigation.navigate("AiLens");
          }}
          accessibilityRole="button"
          accessibilityLabel="Your AI Lens access was approved — finish setup"
          style={{
            flexDirection: "row",
            alignItems: "center",
            margin: 10,
            marginBottom: 4,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#5bb98c",
            backgroundColor: t.colors.bgElevated,
          }}
        >
          <Ionicons name="checkmark-circle" size={18} color="#5bb98c" />
          <Text
            style={[
              t.type.small,
              { color: t.colors.text, flex: 1, marginHorizontal: 8 },
            ]}
          >
            Your AI Lens access was approved — finish setup to start labeling AI
            in your feed.
          </Text>
          <Pressable
            onPress={() => {
              clearApprovalReminder();
              setApprovalReady(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss approval reminder"
            hitSlop={10}
          >
            <Ionicons name="close" size={15} color={t.colors.textTertiary} />
          </Pressable>
        </Pressable>
      ) : null}
      {showAiHero ? (
        <View
          style={{
            margin: 10,
            marginBottom: 4,
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.colors.accent,
            backgroundColor: t.colors.bgElevated,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="scan-outline" size={20} color={t.colors.accent} />
            <Text
              style={[
                t.type.body,
                {
                  color: t.colors.text,
                  fontWeight: "700",
                  marginLeft: 8,
                  flex: 1,
                },
              ]}
            >
              Know what's AI — before you tap
            </Text>
            <Pressable
              onPress={() => {
                markHintSeen("aiLens.hero");
                setAiHeroSeen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss AI Lens introduction"
              hitSlop={10}
            >
              <Ionicons name="close" size={16} color={t.colors.textTertiary} />
            </Pressable>
          </View>
          <Text
            style={[
              t.type.small,
              { color: t.colors.textSecondary, marginTop: 6 },
            ]}
          >
            AI Lens labels AI-written posts and comments right in your feed
            using Open Pangram, the state-of-the-art detector from Pangram Labs
            — judged entirely on your iPhone's Neural Engine, so nothing you
            read ever leaves your phone. One-time setup with a free Hugging Face
            account.
          </Text>
          <Pressable
            onPress={() => {
              markHintSeen("aiLens.hero");
              setAiHeroSeen(true);
              navigation.navigate("AiLens");
            }}
            accessibilityRole="button"
            accessibilityLabel="Set up AI Lens"
            style={{
              backgroundColor: t.colors.accent,
              borderRadius: 10,
              paddingVertical: 9,
              alignItems: "center",
              marginTop: 10,
            }}
          >
            <Text
              style={[t.type.body, { color: t.colors.bg, fontWeight: "700" }]}
            >
              Set up AI Lens
            </Text>
          </Pressable>
        </View>
      ) : null}
      {!longPressTipSeen ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 14,
            paddingVertical: 5,
            backgroundColor: t.colors.bgElevated,
          }}
        >
          <Ionicons name="bulb-outline" size={13} color={t.colors.accent} />
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, flex: 1, marginHorizontal: 8 },
            ]}
            numberOfLines={1}
          >
            Tip: long-press any post for Read Later, follow series, mute & more.
          </Text>
          <Pressable
            onPress={() => {
              markHintSeen("feed.longPress");
              setLongPressTipSeen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss tip"
            hitSlop={8}
          >
            <Ionicons name="close" size={14} color={t.colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );

  const toolbar = (
    <View>
      <View style={[styles.subHeader, { paddingHorizontal: t.spacing.md }]}>
        {canFollow ? (
          <Pressable
            onPress={toggleFollow}
            accessibilityRole="button"
            accessibilityLabel={
              following
                ? `Unfollow ${community!.handle}`
                : `Follow ${community!.handle}`
            }
            accessibilityState={{ selected: following }}
            hitSlop={8}
            style={[
              styles.followPill,
              {
                borderColor: following
                  ? t.colors.border
                  : t.colors.accentActive,
                borderRadius: t.radius.pill,
              },
              following
                ? { backgroundColor: t.colors.bgElevated }
                : { backgroundColor: t.colors.accentActive },
            ]}
          >
            <Text
              style={[
                t.type.small,
                {
                  color: following ? t.colors.textSecondary : "#fff",
                  fontWeight: "700",
                },
              ]}
            >
              {following ? "Following" : "Follow"}
            </Text>
          </Pressable>
        ) : null}
        {community ? (
          <Pressable
            onPress={() => navigation.navigate("Search", { community })}
            accessibilityRole="button"
            accessibilityLabel={`Search in ${community.handle}`}
            hitSlop={10}
            style={styles.viewToggle}
          >
            <Ionicons name="search" size={20} color={t.colors.textSecondary} />
          </Pressable>
        ) : null}
        {community ? (
          <Pressable
            onPress={() => navigation.navigate("CommunityAbout", { community })}
            accessibilityRole="button"
            accessibilityLabel={`About ${community.handle}`}
            hitSlop={10}
            style={styles.viewToggle}
          >
            <Ionicons
              name="information-circle-outline"
              size={22}
              color={t.colors.textSecondary}
            />
          </Pressable>
        ) : null}
        {community || group || multi ? (
          <Pressable
            onPress={() => {
              setCommunity(null);
              setGroup(null);
              setMulti(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              group ? "Clear group filter" : "Clear community filter"
            }
            hitSlop={10}
            style={styles.viewToggle}
          >
            <Ionicons
              name="close-circle"
              size={20}
              color={t.colors.textTertiary}
            />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {viewMode === "list" ? (
          <Pressable
            onPress={() =>
              setDensity((d) => (d === "compact" ? "comfortable" : "compact"))
            }
            accessibilityRole="button"
            accessibilityLabel={
              density === "compact"
                ? "Switch to comfortable cards"
                : "Switch to compact cards"
            }
            hitSlop={10}
            style={styles.viewToggle}
          >
            <Ionicons
              name={
                density === "compact"
                  ? "reorder-four-outline"
                  : "reorder-two-outline"
              }
              size={22}
              color={t.colors.textSecondary}
            />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() =>
            setViewMode((m) => (m === "list" ? "gallery" : "list"))
          }
          accessibilityRole="button"
          accessibilityLabel={
            viewMode === "list"
              ? "Switch to gallery view"
              : "Switch to list view"
          }
          hitSlop={10}
          style={styles.viewToggle}
        >
          <Ionicons
            name={viewMode === "list" ? "grid-outline" : "list-outline"}
            size={20}
            color={t.colors.textSecondary}
          />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: t.spacing.md,
          paddingBottom: t.spacing.sm,
          gap: 8,
        }}
      >
        {feedSorts.map((s) => {
          const active = s.id === sort;
          return (
            <Pressable
              key={s.id}
              onPress={() => chooseSort(s.id)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${s.label}`}
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                { borderRadius: t.radius.pill, borderColor: t.colors.border },
                active
                  ? {
                      backgroundColor: t.colors.accentActive,
                      borderColor: t.colors.accentActive,
                    }
                  : { backgroundColor: t.colors.bgElevated },
              ]}
            >
              <Text
                style={[
                  t.type.meta,
                  { color: active ? "#fff" : t.colors.textSecondary },
                ]}
              >
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {followedHere.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: t.spacing.md,
            paddingBottom: t.spacing.sm,
            gap: 8,
          }}
        >
          {followedHere.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => void openSeries(s)}
              accessibilityRole="button"
              accessibilityLabel={`Open the latest ${s.label}`}
              style={[
                styles.chip,
                styles.seriesChip,
                {
                  borderRadius: t.radius.pill,
                  borderColor: t.colors.accent,
                  backgroundColor: t.colors.bgElevated,
                },
              ]}
            >
              {openingSeries === s.id ? (
                <ActivityIndicator size="small" color={t.colors.accent} />
              ) : (
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={t.colors.accent}
                />
              )}
              <Text
                style={[
                  t.type.meta,
                  { color: t.colors.accent, marginLeft: 6, fontWeight: "600" },
                ]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {flairChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: t.spacing.md,
            paddingBottom: t.spacing.sm,
            gap: 8,
          }}
        >
          {flairChips.map((f) => {
            const active = activeFlair === f.text;
            return (
              <Pressable
                key={f.text}
                onPress={() => setActiveFlair(active ? null : f.text)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by flair ${f.text}`}
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  { borderRadius: t.radius.pill, borderColor: t.colors.border },
                  active
                    ? {
                        backgroundColor: t.colors.accentActive,
                        borderColor: t.colors.accentActive,
                      }
                    : { backgroundColor: t.colors.bgElevated },
                ]}
              >
                <Text
                  style={[
                    t.type.small,
                    { color: active ? "#fff" : t.colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {f.text} · {f.count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  const Footer = () => {
    if (feed.loadingMore)
      return (
        <ActivityIndicator
          color={t.colors.accent}
          style={{ marginVertical: 24 }}
        />
      );
    if (feed.loadMoreError)
      return (
        <Pressable
          onPress={feed.loadMore}
          accessibilityRole="button"
          accessibilityLabel="Retry loading more"
          style={styles.footerRetry}
        >
          <Ionicons name="refresh" size={15} color={t.colors.accent} />
          <Text
            style={[t.type.meta, { color: t.colors.accent, marginLeft: 6 }]}
          >
            Couldn&apos;t load more — tap to retry
          </Text>
        </Pressable>
      );
    if (feed.atEnd && feed.items.length > 0)
      return (
        <Text
          style={[
            t.type.meta,
            styles.caughtUp,
            { color: t.colors.textTertiary },
          ]}
        >
          You&apos;re all caught up
        </Text>
      );
    return <View style={{ height: 24 }} />;
  };

  // A quarantined/gated community returns a warning instead of a feed; the user
  // must accept before we can load it. Opt in, then refetch.
  const gatedError =
    feed.error instanceof GatedContentError ? feed.error : null;
  const acceptGated = async () => {
    if (!community || !communityAdapter?.optInToCommunity || !gatedError)
      return;
    try {
      await communityAdapter.optInToCommunity(
        community.id,
        gatedError.optInKind,
      );
      feed.refresh();
    } catch {
      /* a failed opt-in just re-surfaces as the same gated error on refresh */
    }
  };

  let body: React.ReactNode;
  if (feed.loading) {
    body = <SkeletonFeed />;
  } else if (gatedError && feed.items.length === 0) {
    body = (
      <View style={styles.gated}>
        <Ionicons name="warning-outline" size={40} color={t.colors.accent} />
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, marginTop: 14, textAlign: "center" },
          ]}
        >
          {gatedError.optInKind === "quarantine"
            ? "Quarantined community"
            : "Sensitive community"}
        </Text>
        <Text
          style={[
            t.type.body,
            {
              color: t.colors.textSecondary,
              marginTop: 8,
              textAlign: "center",
            },
          ]}
        >
          {gatedError.warning}
        </Text>
        <Pressable
          onPress={acceptGated}
          accessibilityRole="button"
          accessibilityLabel="Continue to community"
          style={[
            styles.gatedBtn,
            {
              backgroundColor: t.colors.accentActive,
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Text style={[t.type.body, { color: "#fff", fontWeight: "700" }]}>
            Continue
          </Text>
        </Pressable>
      </View>
    );
  } else if (feed.error && feed.items.length === 0) {
    body = (
      <ErrorView
        error={feed.error}
        onRetry={feed.refresh}
        sourceLabel={sourceLabel}
      />
    );
  } else if (viewMode === "gallery") {
    body = (
      <GalleryGrid
        posts={visibleItems}
        onPressPost={openPost}
        onOpenReel={(post) => {
          markSeen(post.id);
          navigation.navigate("Reel", {
            posts: visibleItems,
            postId: post.id,
          });
        }}
        onEndReached={feed.loadMore}
        refreshing={feed.refreshing}
        onRefresh={feed.refresh}
        ListFooterComponent={<Footer />}
        contentBottomInset={insets.bottom + 24}
      />
    );
  } else {
    body = (
      <FlashList
        data={feedEntries}
        keyExtractor={(e) => e.post.id}
        renderItem={({ item }) => {
          const post = item.post;
          const shown = effectivePost(post);
          return (
            <SwipeableVoteRow
              enabled={!adapterForEntity(post).account.isGuest}
              allowDownvote={allowDownvote(post)}
              userVote={shown.userVote}
              saved={shown.saved}
              config={settings.swipe}
              haptics={settings.haptics}
              onUpvote={() => swipeVotePost(post, Vote.Up)}
              onDownvote={() => swipeVotePost(post, Vote.Down)}
              onSave={() => swipeSavePost(post)}
            >
              <PostCard
                post={shown}
                companions={item.companions}
                onPress={() => openPost(post)}
                onLongPress={() => setMenuPost(post)}
                onOpenCommunity={(c) => {
                  // Already pinned to it? A second tap is a no-op.
                  if (community?.id === c.id) return;
                  void resolveCommunityRef(adapterForEntity, c).then(
                    (full) => full && selectCommunity(full),
                  );
                }}
                onOpenMerged={() =>
                  navigation.navigate("MergedDiscussion", {
                    posts: [post, ...item.companions],
                  })
                }
                onOpenPost={(p) => navigation.navigate("Post", { post: p })}
                onOpenImage={(images, index) =>
                  navigation.navigate("ImageViewer", { images, index })
                }
                compact={density === "compact"}
                showSource={multiOrigin || !!group}
                aiVerdict={aiFeedVerdicts.get(post.id)}
                showHumanChip={aiPolicy.showHuman}
                aiPending={
                  aiLensOn &&
                  aiAuto === "ahead" &&
                  aiPolicy.showActivity &&
                  !aiFeedVerdicts.has(post.id) &&
                  (post.body?.text?.trim().length ?? 0) >= MIN_BODY_CHARS
                }
              />
            </SwipeableVoteRow>
          );
        }}
        extraData={`${aiFeedVerdicts.size}-${aiFeedTick}`}
        // FlashList v2 keeps the visible content anchored by default (a
        // chat-list behavior). In a feed it can strand a phantom offset
        // between rows when an early card grows during mount (image/companion
        // strip arriving), leaving a blank band until the user scrolls.
        maintainVisibleContentPosition={{ disabled: true }}
        ListEmptyComponent={
          <EmptyView
            title="Nothing here yet"
            detail="This feed has no posts."
          />
        }
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={feed.refreshing}
        onRefresh={feed.refresh}
        contentContainerStyle={{
          paddingTop: t.spacing.sm,
          paddingBottom: insets.bottom + 24,
        }}
        ListFooterComponent={Footer}
      />
    );
  }

  // Compose is available when signed in to at least one source. A community-
  // scoped feed preselects that community (if the user can post there).
  const canCompose =
    adapters.reddit.account.isGuest === false ||
    lemmyAdapters.some((a) => !a.account.isGuest);
  const composePreset =
    community && !communityAdapter!.account.isGuest ? community : undefined;

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {appBar}
      {toolbar}
      {splitView ? (
        <View style={styles.splitRow}>
          <View
            style={[styles.splitFeed, { borderRightColor: t.colors.border }]}
          >
            {body}
          </View>
          <View style={styles.fill}>
            {detailPost ? (
              <PostScreen
                key={detailPost.id}
                {...({
                  navigation,
                  route: {
                    key: `detail-${detailPost.id}`,
                    name: "Post",
                    params: { post: detailPost },
                  },
                } as React.ComponentProps<typeof PostScreen>)}
              />
            ) : (
              <View style={[styles.fill, styles.splitEmpty]}>
                <Ionicons
                  name="reader-outline"
                  size={40}
                  color={t.colors.textTertiary}
                />
                <Text
                  style={[
                    t.type.body,
                    { color: t.colors.textTertiary, marginTop: 12 },
                  ]}
                >
                  Select a post to read it here
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.fill}>{body}</View>
      )}
      {canCompose ? (
        <Pressable
          onPress={() =>
            navigation.navigate(
              "Compose",
              composePreset ? { presetCommunity: composePreset } : undefined,
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Create a new post"
          style={[
            styles.fab,
            {
              backgroundColor: t.colors.accentActive,
              bottom: insets.bottom + 20,
            },
          ]}
        >
          <Ionicons name="create-outline" size={26} color="#fff" />
        </Pressable>
      ) : null}
      {pickerOpen ? (
        <CommunityPicker
          adapters={adapters}
          scope={feedScope}
          current={community}
          subscribedActive={
            !community && !group && effectiveMode === "subscribed"
          }
          groups={groups}
          currentGroupId={group?.id}
          onChangeScope={setFeedScope}
          onSelectGroup={selectGroup}
          onSelect={selectCommunity}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <ActionSheet
        visible={!!menuPost}
        title={menuPost?.title}
        items={menuPost ? menuItems(menuPost) : []}
        onClose={() => setMenuPost(null)}
      />
      <ActionSheet
        visible={!!multiPick}
        title={multiPick?.title}
        items={multiPick?.items ?? []}
        onClose={() => setMultiPick(null)}
      />
      <CommunityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        groups={groups}
        currentMode={effectiveMode}
        currentGroupId={group?.id}
        currentCommunityId={community?.id ?? multi?.id}
        hasActiveSelection={!!community || !!group || !!multi}
        onSelectScope={(m) => {
          setCommunity(null);
          setGroup(null);
          setMulti(null);
          setMode(m);
        }}
        onSelectGroup={selectGroup}
        onSelectCommunity={selectCommunity}
        onSelectMulti={selectMulti}
        onSelectFavorite={selectFavorite}
        onOpenSearch={() => setPickerOpen(true)}
        onOpenSettings={() => navigation.navigate("Settings")}
        onOpenReadLater={() => navigation.navigate("ReadLater")}
        readLaterCount={drawerOpen ? readLaterCount() : 0}
        onOpenWatches={() => navigation.navigate("Watches")}
        onOpenBriefing={() => navigation.navigate("Briefing")}
        onOpenPlaneMode={() => navigation.navigate("PlaneMode")}
        onOpenProfile={
          ownAccount
            ? () =>
                navigation.navigate("Profile", {
                  userId: ownAccount.id,
                  source: ownAccount.source,
                  handle:
                    ownAccount.source === "reddit"
                      ? `u/${ownAccount.username}`
                      : ownAccount.username,
                })
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barIcon: { padding: 8 },
  barTitle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 4,
  },
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 6,
  },
  modeRow: { flexDirection: "row", gap: 6, paddingBottom: 8 },
  modeTab: { paddingHorizontal: 14, paddingVertical: 6 },
  targetButton: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    paddingVertical: 2,
  },
  viewToggle: { padding: 4, marginLeft: 8 },
  followPill: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  seriesChip: {
    flexDirection: "row",
    borderWidth: 1,
    maxWidth: 280,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  footerRetry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
  },
  caughtUp: { textAlign: "center", paddingVertical: 24 },
  splitRow: { flex: 1, flexDirection: "row" },
  splitFeed: {
    width: 400,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  splitEmpty: { alignItems: "center", justifyContent: "center" },
  gated: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  gatedBtn: {
    marginTop: 22,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
});
