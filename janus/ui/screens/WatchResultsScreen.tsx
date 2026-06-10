import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { resolveCommunityRef } from "../communityNav";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { Markdown } from "../components/Markdown";
import { relativeTime, compactNumber } from "../format";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import { runWatch, runCommentWatch, type WatchAdapters } from "../runWatch";
import {
  getSearch,
  markChecked,
  type SavedSearch,
} from "../../app/savedSearches";
import type { Post, Comment } from "../../core/model";

type Props = NativeStackScreenProps<RootStackParamList, "WatchResults">;

/**
 * One watch's current hits with NEW badges on what you haven't seen. Posts
 * watches list matching posts; comment watches list matching comments from the
 * newest edition of the followed thread series (the r/churning datapoint
 * feed). Viewing marks the watch checked so the count resets next time.
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
  const isComments = watch?.kind === "comments";
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [editionPost, setEditionPost] = useState<Post | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Freeze the seen-set from before this view marked anything.
  const seenOnArrival = useMemo(
    () => new Set(watch?.seenIds ?? []),
    [watch?.id],
  );

  const load = (w: SavedSearch) => {
    setError(null);
    setPosts(null);
    setComments(null);
    const fail = (e: unknown) =>
      setError(e instanceof Error ? e : new Error("Couldn't load results"));
    if (w.kind === "comments") {
      runCommentWatch(w, ctx)
        .then(({ post, matches }) => {
          setEditionPost(post);
          setComments(matches);
          markChecked(
            w.id,
            matches.map((c) => c.id),
          );
        })
        .catch(fail);
    } else {
      runWatch(w, ctx)
        .then((results) => {
          setPosts(results);
          markChecked(
            w.id,
            results.map((p) => p.id),
          );
        })
        .catch(fail);
    }
  };

  useEffect(() => {
    if (watch) load(watch);
  }, [route.params.id]);

  const rows = isComments ? comments : posts;
  const newCount = rows
    ? rows.filter((r) => !seenOnArrival.has(r.id)).length
    : 0;

  const openThread = () => {
    if (editionPost) navigation.navigate("Post", { post: editionPost });
  };

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
          <Text
            style={[t.type.title, { color: t.colors.text }]}
            numberOfLines={1}
          >
            {watch?.query ?? "Watch"}
          </Text>
          <Text
            style={[
              t.type.small,
              {
                color: newCount > 0 ? t.colors.accent : t.colors.textTertiary,
                fontWeight: newCount > 0 ? "700" : "400",
              },
            ]}
            numberOfLines={1}
          >
            {newCount > 0
              ? `${newCount} new since last check`
              : isComments
                ? (watch?.seriesLabel ?? "comments")
                : "no new results"}
          </Text>
        </View>
        {isComments && editionPost ? (
          <Pressable
            onPress={openThread}
            accessibilityRole="button"
            accessibilityLabel="Open the thread"
            hitSlop={8}
          >
            <Ionicons name="open-outline" size={20} color={t.colors.accent} />
          </Pressable>
        ) : null}
      </View>

      {!watch ? (
        <EmptyView title="Watch not found" detail="It may have been removed." />
      ) : error ? (
        <ErrorView
          error={error}
          onRetry={() => load(watch)}
          sourceLabel={watch.communityHandle ?? "Reddit + Lemmy"}
        />
      ) : rows === null ? (
        <LoadingView
          label={
            isComments ? "Scanning the thread…" : "Checking for new posts…"
          }
        />
      ) : isComments ? (
        <FlashList
          data={comments ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => {
            const fresh = !seenOnArrival.has(item.id);
            return (
              <Pressable
                onPress={openThread}
                accessibilityRole="button"
                accessibilityLabel={`Comment by ${item.author.handle}. Tap to open the thread.`}
                style={({ pressed }) => [
                  styles.commentRow,
                  {
                    backgroundColor: pressed
                      ? t.colors.cardPressed
                      : t.colors.bg,
                    borderBottomColor: t.colors.border,
                    borderLeftColor: fresh ? t.colors.accent : "transparent",
                    paddingHorizontal: t.spacing.lg,
                  },
                ]}
              >
                <View style={styles.commentMeta}>
                  {fresh ? (
                    <View
                      style={[
                        styles.newDot,
                        { backgroundColor: t.colors.accent },
                      ]}
                    />
                  ) : null}
                  <Text
                    style={[
                      t.type.small,
                      { color: t.colors.textSecondary, fontWeight: "700" },
                    ]}
                    numberOfLines={1}
                  >
                    {item.author.handle}
                  </Text>
                  <Text
                    style={[
                      t.type.small,
                      { color: t.colors.textTertiary, marginLeft: 6 },
                    ]}
                  >
                    {item.scoreHidden ? "•" : compactNumber(item.score)} ·{" "}
                    {relativeTime(item.createdAt)}
                  </Text>
                </View>
                <View style={{ marginTop: 3 }} pointerEvents="none">
                  <Markdown
                    source={item.body.text ?? ""}
                    numberOfLines={6}
                    color={t.colors.text}
                  />
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyView
              title="No matches yet"
              detail={`Nothing in the latest thread mentions "${watch.query}". Check back later.`}
              icon="chatbubbles-outline"
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      ) : (
        <FlashList
          data={posts ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View>
              {!seenOnArrival.has(item.id) ? (
                <View
                  style={[styles.newTag, { backgroundColor: t.colors.accent }]}
                >
                  <Text
                    style={[t.type.small, { color: "#fff", fontWeight: "700" }]}
                  >
                    NEW
                  </Text>
                </View>
              ) : null}
              <PostCard
                post={item}
                onPress={() => navigation.navigate("Post", { post: item })}
                onOpenCommunity={(c) => {
                  void resolveCommunityRef(adapterForEntity, c).then(
                    (full) =>
                      full &&
                      navigation.navigate("Feed", { openCommunity: full }),
                  );
                }}
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
  commentRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  commentMeta: { flexDirection: "row", alignItems: "center" },
  newDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
});
