import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { EmptyView } from "../components/StateViews";
import { interleave } from "../unifiedFeed";
import type { Post } from "../../core/model";
import type { SourceKind } from "../../core/ids";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

/**
 * Post search. In "All" scope it queries both sources and interleaves the
 * results (source-tagged); scoped to one source it queries just that one.
 * Debounced, with the same race-guard pattern as the community picker.
 */
export function SearchScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { adapters, feedScope } = useAdapters();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const reqId = useRef(0);

  const sources: SourceKind[] =
    feedScope === "all" ? ["reddit", "lemmy"] : [feedScope];
  const unified = feedScope === "all";

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
          sources.map((s) => adapters[s].search(q, "posts", { limit: 25 })),
        );
        if (id !== reqId.current) return;
        const lists = settled.map((r) =>
          r.status === "fulfilled" ? (r.value.items as Post[]) : [],
        );
        const merged =
          lists.length === 2 ? interleave(lists[0], lists[1]) : lists[0];
        setResults(merged);
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
  }, [query, feedScope]);

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
            placeholder={
              unified
                ? "Search Reddit + Lemmy"
                : feedScope === "reddit"
                  ? "Search Reddit"
                  : "Search Lemmy"
            }
            placeholderTextColor={t.colors.textTertiary}
            style={[t.type.body, styles.searchInput, { color: t.colors.text }]}
            accessibilityLabel="Search posts"
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

      {loading ? (
        <ActivityIndicator color={t.colors.accent} style={{ marginTop: 32 }} />
      ) : error ? (
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
          data={results}
          keyExtractor={(p) => p.id}
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={() => navigation.navigate("Post", { post: item })}
              compact
              showSource={unified}
            />
          )}
          ListEmptyComponent={
            query.trim().length >= 2 ? (
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
                Search for posts across your selected sources.
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
});
