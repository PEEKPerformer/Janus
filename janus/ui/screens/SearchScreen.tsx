import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { SourcePill } from "../components/SourcePill";
import { EmptyView } from "../components/StateViews";
import { interleave } from "../unifiedFeed";
import { compactNumber } from "../format";
import { isHttpUrl } from "../links";
import type { Post, Community, User } from "../../core/model";
import type { SourceKind } from "../../core/ids";
import type { SearchKind } from "../../core/adapter";
import type { TimeWindow } from "../../core/capabilities";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

type Scope = "posts" | "communities" | "users";
const SCOPES: { id: Scope; kind: SearchKind; label: string }[] = [
  { id: "posts", kind: "posts", label: "Posts" },
  { id: "communities", kind: "communities", label: "Communities" },
  { id: "users", kind: "users", label: "People" },
];

// A small cross-source post-sort set (each adapter maps these onto its own
// native sorts; unknown ones fall back to the source default).
const SEARCH_SORTS: { id: string; label: string; needsTimeWindow?: boolean }[] =
  [
    { id: "relevance", label: "Relevance" },
    { id: "hot", label: "Hot" },
    { id: "top", label: "Top", needsTimeWindow: true },
    { id: "new", label: "New" },
  ];
const TIME_WINDOWS: TimeWindow[] = [
  "hour",
  "day",
  "week",
  "month",
  "year",
  "all",
];

/**
 * Cross-source search. The scope selector switches between posts, communities
 * (subreddits + Lemmy communities) and people. In "All" feed scope it queries
 * both sources and interleaves the source-tagged results; otherwise it queries
 * just the active source. Debounced, with a request-id race guard.
 */
export function SearchScreen({ navigation, route }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { adapters, feedScope } = useAdapters();

  // When opened with a community, the search is scoped to it (posts only).
  const inCommunity = route.params?.community ?? null;

  const [scope, setScope] = useState<Scope>("posts");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [results, setResults] = useState<(Post | Community | User)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [trending, setTrending] = useState<Community[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const reqId = useRef(0);

  // In-community search hits only that community's source.
  const sources: SourceKind[] = inCommunity
    ? [inCommunity.source]
    : feedScope === "all"
      ? ["reddit", "lemmy"]
      : [feedScope];
  const unified = !inCommunity && feedScope === "all";
  const effectiveScope: Scope = inCommunity ? "posts" : scope;
  const kind = SCOPES.find((s) => s.id === effectiveScope)!.kind;
  const sortMeta = SEARCH_SORTS.find((s) => s.id === sort);
  const showSorts = effectiveScope === "posts";

  // Trending/popular communities power the Communities tab before you type —
  // an Explore surface. Loaded from each source and interleaved.
  useEffect(() => {
    if (scope !== "communities") return;
    let alive = true;
    setTrendingLoading(true);
    Promise.allSettled(
      sources.map(
        (s) => adapters[s].getTrendingCommunities?.() ?? Promise.resolve([]),
      ),
    )
      .then((settled) => {
        if (!alive) return;
        const lists = settled.map((r) =>
          r.status === "fulfilled" ? r.value : [],
        );
        setTrending(
          (lists.length === 2 ? interleave(lists[0], lists[1]) : lists[0]) ??
            [],
        );
      })
      .finally(() => {
        if (alive) setTrendingLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scope, feedScope]);

  const showTrending = scope === "communities" && query.trim().length < 2;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(undefined);
    const timer = setTimeout(async () => {
      try {
        const settled = await Promise.allSettled(
          sources.map((s) =>
            adapters[s].search(q, kind, {
              limit: 25,
              sort: showSorts ? sort : undefined,
              timeWindow:
                showSorts && sortMeta?.needsTimeWindow ? timeWindow : undefined,
              communityId:
                inCommunity && inCommunity.source === s
                  ? inCommunity.id
                  : undefined,
            }),
          ),
        );
        if (id !== reqId.current) return;
        const lists = settled.map((r) =>
          r.status === "fulfilled" ? r.value.items : [],
        );
        const merged =
          lists.length === 2 ? interleave(lists[0], lists[1]) : lists[0];
        setResults(merged as (Post | Community | User)[]);
        if (
          merged.length === 0 &&
          settled.every((r) => r.status === "rejected")
        ) {
          setError("Couldn't search. Check your connection.");
        }
      } catch {
        if (id === reqId.current) setError("Couldn't search.");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, feedScope, effectiveScope, sort, timeWindow]);

  const placeholder = inCommunity
    ? `Search ${inCommunity.handle}`
    : scope === "communities"
      ? unified
        ? "Search communities"
        : feedScope === "reddit"
          ? "Search subreddits"
          : "Search Lemmy communities"
      : scope === "users"
        ? "Search people"
        : unified
          ? "Search Reddit + Lemmy"
          : feedScope === "reddit"
            ? "Search Reddit"
            : "Search Lemmy";

  const renderCommunity = (c: Community) => (
    <Pressable
      onPress={() => navigation.navigate("Feed", { openCommunity: c })}
      accessibilityRole="button"
      accessibilityLabel={`Open ${c.handle}`}
      style={({ pressed }) => [
        styles.entityRow,
        { backgroundColor: pressed ? t.colors.cardPressed : "transparent" },
      ]}
    >
      {isHttpUrl(c.icon) ? (
        <Image source={{ uri: c.icon }} style={styles.entityIcon} />
      ) : (
        <View style={[styles.entityIcon, styles.entityIconFallback]}>
          <Ionicons name="people" size={18} color={t.colors.textTertiary} />
        </View>
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.entityNameRow}>
          <Text
            style={[t.type.meta, { color: t.colors.text, fontWeight: "700" }]}
            numberOfLines={1}
          >
            {c.handle}
          </Text>
          {unified ? (
            <SourcePill source={c.source} instance={c.instance} size="xs" />
          ) : null}
        </View>
        <Text
          style={[t.type.small, { color: t.colors.textTertiary, marginTop: 1 }]}
          numberOfLines={1}
        >
          {compactNumber(c.subscriberCount)} members
          {c.description?.text ? ` · ${c.description.text}` : ""}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={t.colors.textTertiary}
      />
    </Pressable>
  );

  const renderUser = (u: User) => (
    <Pressable
      onPress={() =>
        navigation.navigate("Profile", {
          userId: u.id,
          source: u.source,
          handle: u.handle,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Open ${u.handle}`}
      style={({ pressed }) => [
        styles.entityRow,
        { backgroundColor: pressed ? t.colors.cardPressed : "transparent" },
      ]}
    >
      {isHttpUrl(u.avatar) ? (
        <Image source={{ uri: u.avatar }} style={styles.entityIcon} />
      ) : (
        <View style={[styles.entityIcon, styles.entityIconFallback]}>
          <Ionicons name="person" size={18} color={t.colors.textTertiary} />
        </View>
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.entityNameRow}>
          <Text
            style={[t.type.meta, { color: t.colors.text, fontWeight: "700" }]}
            numberOfLines={1}
          >
            {u.handle}
          </Text>
          {unified ? (
            <SourcePill source={u.source} instance={u.instance} size="xs" />
          ) : null}
        </View>
        {u.postScore !== undefined ? (
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, marginTop: 1 },
            ]}
            numberOfLines={1}
          >
            {compactNumber(u.postScore)}{" "}
            {u.source === "reddit" ? "post karma" : "posts"}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={t.colors.textTertiary}
      />
    </Pressable>
  );

  const renderItem = ({ item }: { item: Post | Community | User }) => {
    if (effectiveScope === "communities")
      return renderCommunity(item as Community);
    if (effectiveScope === "users") return renderUser(item as User);
    return (
      <PostCard
        post={item as Post}
        onPress={() => navigation.navigate("Post", { post: item as Post })}
        compact
        showSource={unified}
      />
    );
  };

  return (
    <View
      style={[
        styles.fill,
        { backgroundColor: t.colors.bg, paddingTop: insets.top + 8 },
      ]}
    >
      <View style={[styles.searchWrap, { paddingHorizontal: t.spacing.md }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ marginRight: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={t.colors.text} />
        </Pressable>
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
            },
          ]}
        >
          <Ionicons name="search" size={16} color={t.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            placeholder={placeholder}
            placeholderTextColor={t.colors.textTertiary}
            style={[t.type.body, styles.searchInput, { color: t.colors.text }]}
            accessibilityLabel="Search"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery("")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons
                name="close-circle"
                size={16}
                color={t.colors.textTertiary}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {inCommunity ? (
        <View style={[styles.inComm, { borderBottomColor: t.colors.border }]}>
          <Ionicons
            name={inCommunity.source === "reddit" ? "logo-reddit" : "planet"}
            size={14}
            color={
              inCommunity.source === "reddit" ? t.colors.reddit : t.colors.lemmy
            }
          />
          <Text
            style={[
              t.type.small,
              { color: t.colors.textSecondary, marginLeft: 6 },
            ]}
            numberOfLines={1}
          >
            Searching in {inCommunity.handle}
          </Text>
        </View>
      ) : (
        <View style={[styles.scopes, { borderBottomColor: t.colors.border }]}>
          {SCOPES.map((s) => {
            const active = s.id === scope;
            return (
              <Pressable
                key={s.id}
                onPress={() => setScope(s.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.label}
                style={[
                  styles.scopeTab,
                  {
                    borderBottomColor: active ? t.colors.accent : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    t.type.meta,
                    {
                      color: active ? t.colors.text : t.colors.textTertiary,
                      fontWeight: active ? "700" : "500",
                    },
                  ]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Post-search sort + time window */}
      {showSorts ? (
        <View style={styles.sortBar}>
          {SEARCH_SORTS.map((s) => {
            const active = s.id === sort;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSort(s.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Sort by ${s.label}`}
                style={[
                  styles.sortPill,
                  {
                    borderRadius: t.radius.pill,
                    backgroundColor: active
                      ? t.colors.accentActive
                      : t.colors.bgElevated,
                    borderColor: active
                      ? t.colors.accentActive
                      : t.colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    t.type.small,
                    {
                      color: active ? "#fff" : t.colors.textSecondary,
                      fontWeight: "600",
                    },
                  ]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
          {sortMeta?.needsTimeWindow ? (
            <Pressable
              onPress={() => {
                const i = TIME_WINDOWS.indexOf(timeWindow);
                setTimeWindow(TIME_WINDOWS[(i + 1) % TIME_WINDOWS.length]);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Time window: ${timeWindow}. Tap to change.`}
              style={[
                styles.sortPill,
                {
                  borderRadius: t.radius.pill,
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                },
              ]}
            >
              <Ionicons name="time-outline" size={12} color={t.colors.accent} />
              <Text
                style={[
                  t.type.small,
                  { color: t.colors.accent, marginLeft: 4, fontWeight: "600" },
                ]}
              >
                {timeWindow}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {(showTrending ? trendingLoading : loading) ? (
        <ActivityIndicator color={t.colors.accent} style={{ marginTop: 32 }} />
      ) : error && !showTrending ? (
        <Text
          style={[
            t.type.meta,
            {
              color: t.colors.danger,
              textAlign: "center",
              marginTop: 32,
              paddingHorizontal: 24,
            },
          ]}
        >
          {error}
        </Text>
      ) : (
        <FlashList
          data={showTrending ? trending : results}
          keyExtractor={(item) => item.id}
          keyboardDismissMode="on-drag"
          renderItem={renderItem}
          ListHeaderComponent={
            showTrending && trending.length > 0 ? (
              <Text
                style={[
                  t.type.small,
                  styles.trendingHeader,
                  { color: t.colors.textTertiary },
                ]}
              >
                TRENDING COMMUNITIES
              </Text>
            ) : null
          }
          ListEmptyComponent={
            showTrending ? null : query.trim().length >= 2 ? (
              <EmptyView
                title="No results"
                detail="Try different keywords."
                icon="search-outline"
              />
            ) : (
              <Text
                style={[
                  t.type.meta,
                  {
                    color: t.colors.textTertiary,
                    textAlign: "center",
                    marginTop: 32,
                    paddingHorizontal: 24,
                  },
                ]}
              >
                {scope === "users"
                  ? "Find people across your sources."
                  : "Search for posts across your selected sources."}
              </Text>
            )
          }
          contentContainerStyle={{
            paddingTop: t.spacing.sm,
            paddingBottom: insets.bottom + 24,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  searchWrap: { flexDirection: "row", alignItems: "center", paddingBottom: 10 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, marginLeft: 8, paddingVertical: 0 },
  scopes: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scopeTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  inComm: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sortPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  entityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  entityIcon: { width: 38, height: 38, borderRadius: 19 },
  entityIconFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(127,127,127,0.15)",
  },
  entityNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  trendingHeader: {
    fontWeight: "700",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
});
