import React, { useEffect, useRef, useState } from "react";
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
import { createUnifiedFeed, UNIFIED_FEED_SORTS } from "../unifiedFeed";
import { CommunityPicker } from "../components/CommunityPicker";
import type { Post, Community } from "../../core/model";
import type { TimeWindow, SortOption } from "../../core/capabilities";

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;
type ViewMode = "list" | "gallery";
type Density = "compact" | "comfortable";

export function FeedScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { adapter, adapters, activeSource, feedScope, accountVersion } =
    useAdapters();

  const [community, setCommunity] = useState<Community | null>(null);
  const [subscribed, setSubscribed] = useState(false); // "Subscribed" home listing
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [density, setDensity] = useState<Density>("compact");

  // A selected community pins the feed to ONE source; otherwise "all" scope is
  // the unified stream and a single scope is that one source.
  const communityAdapter = community ? adapters[community.source] : null;
  const unified = feedScope === "all" && !community;
  const effectiveAdapter = communityAdapter ?? adapter;

  const feedSorts: readonly SortOption[] = community
    ? communityAdapter!.capabilities.sorts.feed
    : unified
      ? UNIFIED_FEED_SORTS
      : adapter.capabilities.sorts.feed;
  const [sort, setSort] = useState<string>(feedSorts[0]?.id ?? "hot");

  // When the scope or community changes, the available sorts change too — snap
  // back to the first valid sort.
  useEffect(() => {
    setSort(feedSorts[0]?.id ?? "hot");
  }, [feedScope, adapter, community?.id]);

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow
    ? "day"
    : undefined;
  const singleListing = subscribed
    ? activeSource === "lemmy"
      ? "Subscribed"
      : "home"
    : activeSource === "lemmy"
      ? "All"
      : "popular";

  const feed = useFeed<Post>(
    community
      ? (page) =>
          communityAdapter!.getFeed(
            { communityId: community.id, sort, timeWindow },
            page,
          )
      : unified
        ? createUnifiedFeed(adapters, { sort, timeWindow, subscribed })
        : (page) =>
            adapter.getFeed(
              { listingType: singleListing, sort, timeWindow },
              page,
            ),
    [feedScope, activeSource, sort, accountVersion, community?.id, subscribed],
  );

  const targetLabel = community
    ? community.handle
    : subscribed
      ? "Subscribed"
      : unified
        ? "All sources"
        : activeSource === "lemmy"
          ? adapter.instance
          : "Popular";
  const sourceLabel = community
    ? community.source === "reddit"
      ? "Reddit"
      : effectiveAdapter.instance
    : unified
      ? "Reddit + Lemmy"
      : activeSource === "reddit"
        ? "Reddit"
        : adapter.instance;

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
      setSubscribed(true);
    } else {
      setCommunity(sel);
      setSubscribed(false);
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
            showSource={unified}
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
    adapters.lemmy.account.isGuest === false;
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
          subscribedActive={subscribed}
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
