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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useFeed } from "../hooks";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { GalleryGrid } from "../components/GalleryGrid";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { createAggregateFeed, UNIFIED_FEED_SORTS } from "../unifiedFeed";
import { buildAggregateSpecs, type FeedMode } from "../feedSources";
import { CommunityPicker } from "../components/CommunityPicker";
import type { SourceAdapter } from "../../core/adapter";
import type { Post, Community } from "../../core/model";
import type { TimeWindow, SortOption } from "../../core/capabilities";

const MODE_LABELS: Record<FeedMode, string> = {
  subscribed: "Subscribed",
  all: "All",
  local: "Local",
};

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;
type ViewMode = "list" | "gallery";
type Density = "compact" | "comfortable";

export function FeedScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {
    adapters,
    feedScope,
    accountVersion,
    lemmyAdapters,
    adapterForEntity,
  } = useAdapters();

  const [community, setCommunity] = useState<Community | null>(null);
  const [mode, setMode] = useState<FeedMode>("subscribed");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [density, setDensity] = useState<Density>("compact");

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

  const availableModes: FeedMode[] = hasLemmy
    ? ["subscribed", "all", "local"]
    : ["subscribed", "all"];

  const feedSorts: readonly SortOption[] = community
    ? communityAdapter!.capabilities.sorts.feed
    : mixed || activePool.length === 0
      ? UNIFIED_FEED_SORTS
      : activePool[0].capabilities.sorts.feed;
  const [sort, setSort] = useState<string>(feedSorts[0]?.id ?? "hot");

  // When the scope/mode/community changes, the available sorts change too —
  // snap back to the first valid sort.
  useEffect(() => {
    setSort(feedSorts[0]?.id ?? "hot");
  }, [feedScope, effectiveMode, community?.id]);

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow
    ? "day"
    : undefined;

  // Pool identity in the deps so the feed rebuilds when accounts/instances change.
  const poolKey = activePool.map((a) => `${a.source}:${a.instance}`).join(",");
  const feed = useFeed<Post>(
    community
      ? (page) =>
          communityAdapter!.getFeed(
            { communityId: community.id, sort, timeWindow },
            page,
          )
      : createAggregateFeed(
          buildAggregateSpecs(activePool, effectiveMode, { sort, timeWindow }),
        ),
    [feedScope, effectiveMode, sort, accountVersion, community?.id, poolKey],
  );

  const targetLabel = community ? community.handle : MODE_LABELS[effectiveMode];
  const sourceLabel = community
    ? community.source === "reddit"
      ? "Reddit"
      : communityAdapter!.instance
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

  const openPost = (post: Post) => navigation.navigate("Post", { post });

  const selectCommunity = (sel: Community | null | "subscribed") => {
    if (sel === "subscribed") {
      setCommunity(null);
      setMode("subscribed");
    } else {
      setCommunity(sel);
    }
    setPickerOpen(false);
  };

  const toolbar = (
    <View>
      <View style={[styles.subHeader, { paddingHorizontal: t.spacing.md }]}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            community
              ? `Browsing ${community.handle}. Change community.`
              : "Choose a community"
          }
          hitSlop={8}
          style={styles.targetButton}
        >
          <Text
            style={[t.type.title, { color: t.colors.text, flexShrink: 1 }]}
            numberOfLines={1}
          >
            {targetLabel}
          </Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={t.colors.textSecondary}
            style={{ marginLeft: 4 }}
          />
        </Pressable>
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
            onPress={() => setCommunity(null)}
            accessibilityRole="button"
            accessibilityLabel="Clear community filter"
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
        <Pressable
          onPress={() => navigation.navigate("Search")}
          accessibilityRole="button"
          accessibilityLabel="Search posts"
          hitSlop={10}
          style={styles.viewToggle}
        >
          <Ionicons name="search" size={20} color={t.colors.textSecondary} />
        </Pressable>
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
      {!community ? (
        <View style={[styles.modeRow, { paddingHorizontal: t.spacing.md }]}>
          {availableModes.map((m) => {
            const active = m === effectiveMode;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="tab"
                accessibilityLabel={`${MODE_LABELS[m]} feed`}
                accessibilityState={{ selected: active }}
                style={[
                  styles.modeTab,
                  { borderRadius: t.radius.pill },
                  active
                    ? { backgroundColor: t.colors.accentActive }
                    : { backgroundColor: t.colors.bgElevated },
                ]}
              >
                <Text
                  style={[
                    t.type.small,
                    {
                      color: active ? "#fff" : t.colors.textSecondary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {MODE_LABELS[m]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
        posts={feed.items}
        onPressPost={openPost}
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
        data={feed.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={() => openPost(item)}
            compact={density === "compact"}
            showSource={multiOrigin}
          />
        )}
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
          subscribedActive={!community && effectiveMode === "subscribed"}
          onSelect={selectCommunity}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
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
