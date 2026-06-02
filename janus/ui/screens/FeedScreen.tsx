import React, { useEffect, useMemo, useState } from "react";
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
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import type { Post } from "../../core/model";
import type { TimeWindow } from "../../core/capabilities";

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;

export function FeedScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { adapter, activeSource } = useAdapters();

  const feedSorts = adapter.capabilities.sorts.feed;
  const [sort, setSort] = useState<string>(feedSorts[0]?.id ?? "hot");

  useEffect(() => {
    setSort(adapter.capabilities.sorts.feed[0]?.id ?? "hot");
  }, [activeSource, adapter]);

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow ? "day" : undefined;
  const listingType = activeSource === "lemmy" ? "All" : "popular";

  const feed = useFeed<Post>((page) => adapter.getFeed({ listingType, sort, timeWindow }, page), [activeSource, sort]);

  const targetLabel = activeSource === "lemmy" ? adapter.instance : "Popular";
  const sourceLabel = activeSource === "reddit" ? "Reddit" : adapter.instance;

  const TargetHeader = () => (
    <View style={[styles.subHeader, { paddingHorizontal: t.spacing.md }]}>
      <Text style={[t.type.title, { color: t.colors.text }]}>{targetLabel}</Text>
    </View>
  );

  const sortRow = useMemo(
    () => (
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
    ),
    [feedSorts, sort, t],
  );

  const listHeader = useMemo(
    () => (
      <View>
        <TargetHeader />
        {sortRow}
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortRow, targetLabel, t],
  );

  if (feed.loading) {
    return (
      <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
        <TargetHeader />
        {sortRow}
        <SkeletonFeed />
      </View>
    );
  }

  if (feed.error && feed.items.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
        <TargetHeader />
        <ErrorView error={feed.error} onRetry={feed.refresh} sourceLabel={sourceLabel} />
      </View>
    );
  }

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

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <FlashList
        data={feed.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PostCard post={item} onPress={() => navigation.navigate("Post", { post: item })} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<EmptyView title="Nothing here yet" detail="This feed has no posts." />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={feed.refreshing}
        onRefresh={feed.refresh}
        contentContainerStyle={{ paddingTop: t.spacing.sm, paddingBottom: insets.bottom + 24 }}
        ListFooterComponent={Footer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  subHeader: { paddingTop: 8, paddingBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, minHeight: 38, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  footerRetry: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 18 },
  caughtUp: { textAlign: "center", paddingVertical: 24 },
});
