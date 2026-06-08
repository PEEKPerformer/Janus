import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useFeed } from "../hooks";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
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
import { CommunityPicker } from "../components/CommunityPicker";
import { CommunityDrawer } from "../components/CommunityDrawer";
import { SwipeableVoteRow } from "../components/SwipeableVoteRow";
import { applyVote } from "../swipeVote";
import { useSettings } from "../SettingsContext";
import { filterPosts } from "../postFilters";
import { Vote } from "../../core/vote";
import type { SourceAdapter } from "../../core/adapter";
import type { Post, Community } from "../../core/model";
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
  const { settings } = useSettings();
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

  // When the scope/mode/community changes, the available sorts change too —
  // snap back to the user's default (or the first valid sort).
  useEffect(() => {
    setSort(resolveSort(feedSorts));
  }, [
    feedScope,
    effectiveMode,
    community?.id,
    group?.id,
    settings.defaultPostSort,
  ]);

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow
    ? settings.topTimeWindow
    : undefined;

  // Pool identity in the deps so the feed rebuilds when accounts/instances change.
  const poolKey = activePool.map((a) => `${a.source}:${a.instance}`).join(",");
  // Feed-blend weights — only bites when the pool actually mixes Reddit + Lemmy.
  const mixWeight = (source: SourceAdapter["source"]): number => {
    if (settings.feedMix === "reddit") return source === "reddit" ? 3 : 1;
    if (settings.feedMix === "lemmy") return source === "lemmy" ? 3 : 1;
    return 1;
  };
  const feed = useFeed<Post>(
    community
      ? (page) =>
          communityAdapter!.getFeed(
            { communityId: community.id, sort, timeWindow },
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
      group?.id,
      poolKey,
      settings.feedMix,
    ],
  );

  const targetLabel = community
    ? community.handle
    : group
      ? group.name
      : MODE_LABELS[effectiveMode];
  const sourceLabel = community
    ? community.source === "reddit"
      ? "Reddit"
      : communityAdapter!.instance
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

  // Apply the user's client-side filters (muted communities/users, keywords,
  // hide-NSFW) to the merged pool — one filter, both sources.
  const visibleItems = useMemo(
    () =>
      filterPosts(feed.items, {
        filters: settings.filters,
        hideNsfw: settings.hideNsfw,
      }),
    [feed.items, settings.filters, settings.hideNsfw],
  );

  const effectivePost = (p: Post): Post => {
    const o = voteOverlay[p.id];
    return o
      ? { ...p, userVote: o.userVote, score: o.score, saved: o.saved }
      : p;
  };

  const allowDownvote = (p: Post) =>
    downvotesByKey[`${p.source}:${p.instance}`] ?? true;

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
      .catch(() =>
        setVoteOverlay((o) => {
          const next = { ...o };
          delete next[post.id];
          return next;
        }),
      );
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
    navigation.navigate("Post", { post });
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
    if (sel === "subscribed") {
      setCommunity(null);
      setMode("subscribed");
    } else {
      if (sel) recordCommunity(sel);
      setCommunity(sel);
    }
    setPickerOpen(false);
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
        {community || group ? (
          <Pressable
            onPress={() => {
              setCommunity(null);
              setGroup(null);
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
              onPress={() => setSort(s.id)}
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

  let body: React.ReactNode;
  if (feed.loading) {
    body = <SkeletonFeed />;
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
        onOpenImage={(images, index) =>
          navigation.navigate("ImageViewer", { images, index })
        }
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
        data={visibleItems}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => {
          const shown = effectivePost(item);
          return (
            <SwipeableVoteRow
              enabled={!adapterForEntity(item).account.isGuest}
              allowDownvote={allowDownvote(item)}
              userVote={shown.userVote}
              saved={shown.saved}
              config={settings.swipe}
              haptics={settings.haptics}
              onUpvote={() => swipeVotePost(item, Vote.Up)}
              onDownvote={() => swipeVotePost(item, Vote.Down)}
              onSave={() => swipeSavePost(item)}
            >
              <PostCard
                post={shown}
                onPress={() => openPost(item)}
                onOpenImage={(images, index) =>
                  navigation.navigate("ImageViewer", { images, index })
                }
                compact={density === "compact"}
                showSource={multiOrigin || !!group}
              />
            </SwipeableVoteRow>
          );
        }}
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
      <View style={styles.fill}>{body}</View>
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
      <CommunityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        groups={groups}
        currentMode={effectiveMode}
        currentGroupId={group?.id}
        currentCommunityId={community?.id}
        hasActiveSelection={!!community || !!group}
        onSelectScope={(m) => {
          setCommunity(null);
          setGroup(null);
          setMode(m);
        }}
        onSelectGroup={selectGroup}
        onSelectCommunity={selectCommunity}
        onSelectFavorite={selectFavorite}
        onOpenSearch={() => setPickerOpen(true)}
        onOpenSettings={() => navigation.navigate("Settings")}
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
});
