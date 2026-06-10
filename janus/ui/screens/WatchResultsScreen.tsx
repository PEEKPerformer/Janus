import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import {
  LoadingView,
  ErrorView,
  EmptyView,
} from "../components/StateViews";
import { runWatch, type WatchAdapters } from "../runWatch";
import {
  getSearch,
  markChecked,
  type SavedSearch,
} from "../../app/savedSearches";
import type { Post } from "../../core/model";

type Props = NativeStackScreenProps<RootStackParamList, "WatchResults">;

/**
 * One watch's current hits, newest first, with NEW badges on results you
 * haven't seen yet. Viewing marks the watch checked (so the count resets and
 * these stop reading as new next time). Cross-network — results already merge
 * Reddit + Lemmy inside {@link runWatch}.
 */
export function WatchResultsScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { adapters, adapterForEntity } = useAdapters();
  const ctx: WatchAdapters = {
    reddit: adapters.reddit,
    lemmy: adapters.lemmy,
    adapterForEntity,
  };

  const watch = getSearch(route.params.id);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Freeze the seen-set from before this view marked anything, so the NEW
  // badges reflect what was new on arrival.
  const seenOnArrival = useMemo(
    () => new Set(watch?.seenIds ?? []),
    [watch?.id],
  );

  const load = (w: SavedSearch) => {
    setError(null);
    setPosts(null);
    runWatch(w, ctx)
      .then((results) => {
        setPosts(results);
        // Mark everything currently shown as seen → resets the badge next time.
        markChecked(
          w.id,
          results.map((p) => p.id),
        );
      })
      .catch((e) =>
        setError(e instanceof Error ? e : new Error("Couldn't load results")),
      );
  };

  useEffect(() => {
    if (watch) load(watch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.id]);

  const newCount = posts
    ? posts.filter((p) => !seenOnArrival.has(p.id)).length
    : 0;

  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: t.colors.bg }]}
      edges={["top"]}
    >
      <View style={[styles.topBar, { paddingHorizontal: t.spacing.lg }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={t.colors.accent} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[t.type.title, { color: t.colors.text }]} numberOfLines={1}>
            {watch?.query ?? "Watch"}
          </Text>
          {newCount > 0 ? (
            <Text style={[t.type.small, { color: t.colors.accent, fontWeight: "700" }]}>
              {newCount} new since last check
            </Text>
          ) : null}
        </View>
      </View>

      {!watch ? (
        <EmptyView title="Watch not found" detail="It may have been removed." />
      ) : error ? (
        <ErrorView
          error={error}
          onRetry={() => load(watch)}
          sourceLabel={watch.communityHandle ?? "Reddit + Lemmy"}
        />
      ) : posts === null ? (
        <LoadingView label="Checking for new posts…" />
      ) : (
        <FlashList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View>
              {!seenOnArrival.has(item.id) ? (
                <View
                  style={[
                    styles.newTag,
                    { backgroundColor: t.colors.accent },
                  ]}
                >
                  <Text style={[t.type.small, { color: "#fff", fontWeight: "700" }]}>
                    NEW
                  </Text>
                </View>
              ) : null}
              <PostCard
                post={item}
                onPress={() => navigation.navigate("Post", { post: item })}
                compact
                showSource={!watch.communityId && watch.source === "all"}
              />
            </View>
          )}
          ListEmptyComponent={
            <EmptyView
              title="No matches right now"
              detail="Nothing matches this search yet. Check back later."
              icon="search-outline"
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  newTag: {
    position: "absolute",
    top: 8,
    right: 16,
    zIndex: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
