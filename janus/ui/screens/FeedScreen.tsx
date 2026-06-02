import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import type { Post } from "../../core/model";
import type { TimeWindow } from "../../core/capabilities";

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;
type ViewMode = "list" | "gallery";

export function FeedScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { adapter, activeSource } = useAdapters();

  const feedSorts = adapter.capabilities.sorts.feed;
  const [sort, setSort] = useState<string>(feedSorts[0]?.id ?? "hot");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  useEffect(() => {
    setSort(adapter.capabilities.sorts.feed[0]?.id ?? "hot");
  }, [activeSource, adapter]);

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow ? "day" : undefined;
  const listingType = activeSource === "lemmy" ? "All" : "popular";

  const feed = useFeed<Post>((page) => adapter.getFeed({ listingType, sort, timeWindow }, page), [activeSource, sort]);

  const targetLabel = activeSource === "lemmy" ? adapter.instance : "Popular";
  const sourceLabel = activeSource === "reddit" ? "Reddit" : adapter.instance;

  const openPost = (post: Post) => navigation.navigate("Post", { post });

  const toolbar = (
    <View>
      <View style={[styles.subHeader, { paddingHorizontal: t.spacing.md }]}>
        <Text style={[t.type.title, { color: t.colors.text, flex: 1 }]} numberOfLines={1}>
          {targetLabel}
        </Text>
        <Pressable
          onPress={() => setViewMode((m) => (m === "list" ? "gallery" : "list"))}
          accessibilityRole="button"
          accessibilityLabel={viewMode === "list" ? "Switch to gallery view" : "Switch to list view"}
          hitSlop={10}
          style={styles.viewToggle}
        >
          <Ionicons name={viewMode === "list" ? "grid-outline" : "list-outline"} size={20} color={t.colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: t.spacing.md, paddingBottom: t.spacing.sm, gap: 8 }}
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
                active ? { backgroundColor: t.colors.accentActive, borderColor: t.colors.accentActive } : { backgroundColor: t.colors.bgElevated },
              ]}
            >
              <Text style={[t.type.meta, { color: active ? "#fff" : t.colors.textSecondary }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const Footer = () => {
    if (feed.loadingMore) return <ActivityIndicator color={t.colors.accent} style={{ marginVertical: 24 }} />;
    if (feed.loadMoreError)
      return (
        <Pressable onPress={feed.loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more" style={styles.footerRetry}>
          <Ionicons name="refresh" size={15} color={t.colors.accent} />
          <Text style={[t.type.meta, { color: t.colors.accent, marginLeft: 6 }]}>Couldn&apos;t load more — tap to retry</Text>
        </Pressable>
      );
    if (feed.atEnd && feed.items.length > 0)
      return <Text style={[t.type.meta, styles.caughtUp, { color: t.colors.textTertiary }]}>You&apos;re all caught up</Text>;
    return <View style={{ height: 24 }} />;
  };

  let body: React.ReactNode;
  if (feed.loading) {
    body = <SkeletonFeed />;
  } else if (feed.error && feed.items.length === 0) {
    body = <ErrorView error={feed.error} onRetry={feed.refresh} sourceLabel={sourceLabel} />;
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
        renderItem={({ item }) => <PostCard post={item} onPress={() => openPost(item)} />}
        ListEmptyComponent={<EmptyView title="Nothing here yet" detail="This feed has no posts." />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={feed.refreshing}
        onRefresh={feed.refresh}
        contentContainerStyle={{ paddingTop: t.spacing.sm, paddingBottom: insets.bottom + 24 }}
        ListFooterComponent={Footer}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {toolbar}
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  subHeader: { flexDirection: "row", alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  viewToggle: { padding: 4, marginLeft: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, minHeight: 38, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  footerRetry: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 18 },
  caughtUp: { textAlign: "center", paddingVertical: 24 },
});
