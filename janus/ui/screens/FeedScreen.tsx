import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useFeed } from "../hooks";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import type { Post } from "../../core/model";
import type { TimeWindow } from "../../core/capabilities";

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;

export function FeedScreen({ navigation }: Props) {
  const t = useTheme();
  const { adapter, activeSource } = useAdapters();

  const feedSorts = adapter.capabilities.sorts.feed;
  const [sort, setSort] = useState<string>(feedSorts[0]?.id ?? "hot");

  // Reset sort to the active source's default when switching sources.
  useEffect(() => {
    setSort(adapter.capabilities.sorts.feed[0]?.id ?? "hot");
  }, [activeSource, adapter]);

  const sortMeta = feedSorts.find((s) => s.id === sort);
  const timeWindow: TimeWindow | undefined = sortMeta?.needsTimeWindow ? "day" : undefined;
  const listingType = activeSource === "lemmy" ? "All" : "popular";

  const feed = useFeed<Post>(
    (page) => adapter.getFeed({ listingType, sort, timeWindow }, page),
    [activeSource, sort],
  );

  const targetLabel = activeSource === "lemmy" ? `${adapter.instance}` : "Popular";

  const header = useMemo(
    () => (
      <View>
        <View style={[styles.subHeader, { paddingHorizontal: t.spacing.md }]}>
          <Text style={[t.type.title, { color: t.colors.text }]}>{targetLabel}</Text>
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
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  { borderRadius: t.radius.pill, borderColor: t.colors.border },
                  active ? { backgroundColor: t.colors.accent, borderColor: t.colors.accent } : { backgroundColor: t.colors.bgElevated },
                ]}
              >
                <Text style={[t.type.meta, { color: active ? "#fff" : t.colors.textSecondary }]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    ),
    [feedSorts, sort, targetLabel, t],
  );

  if (feed.loading) {
    return (
      <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
        {header}
        <LoadingView label={`Loading ${targetLabel}…`} />
      </View>
    );
  }

  if (feed.error && feed.items.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
        {header}
        <ErrorView error={feed.error} onRetry={feed.refresh} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <FlashList
        data={feed.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PostCard post={item} onPress={() => navigation.navigate("Post", { post: item })} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyView title="Nothing here yet" detail="This feed has no posts." />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={feed.refreshing}
        onRefresh={feed.refresh}
        contentContainerStyle={{ paddingVertical: t.spacing.sm }}
        ListFooterComponent={
          feed.loadingMore ? <ActivityIndicator color={t.colors.accent} style={{ marginVertical: 24 }} /> : <View style={{ height: 24 }} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  subHeader: { paddingTop: 8, paddingBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: StyleSheet.hairlineWidth },
});
