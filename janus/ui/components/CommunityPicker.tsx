import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AdapterMap, FeedScope } from "../AdapterContext";
import type { Community } from "../../core/model";
import { useTheme } from "../theme";
import { compactNumber } from "../format";
import { isHttpUrl } from "../links";
import { interleave } from "../unifiedFeed";

/**
 * Community picker — search subreddits and Lemmy communities and scope the feed
 * to one (the sidebar/jump affordance both Hydra and Voyager have). In the "All"
 * scope it searches BOTH sources at once and tags each result; scoped to one
 * source it searches just that one. Selecting a community hands it back to the
 * feed; "Home" clears the selection.
 */
export function CommunityPicker({
  adapters,
  scope,
  current,
  onSelect,
  onClose,
}: {
  adapters: AdapterMap;
  scope: FeedScope;
  current?: Community | null;
  onSelect: (community: Community | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Community[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const reqId = useRef(0);

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
        const sources =
          scope === "all" ? (["reddit", "lemmy"] as const) : ([scope] as const);
        const settled = await Promise.allSettled(
          sources.map((s) => adapters[s].searchCommunities(q, { limit: 25 })),
        );
        if (id !== reqId.current) return; // a newer query superseded this one
        const lists = settled.map((r) =>
          r.status === "fulfilled" ? r.value.items : [],
        );
        const merged =
          lists.length === 2 ? interleave(lists[0], lists[1]) : lists[0];
        setResults(merged);
        if (
          merged.length === 0 &&
          settled.every((r) => r.status === "rejected")
        ) {
          setError("Couldn't search communities. Check your connection.");
        }
      } catch {
        if (id === reqId.current) setError("Couldn't search communities.");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, scope, adapters]);

  const renderItem = ({ item }: { item: Community }) => {
    const sourceColor =
      item.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
    const selected = current?.id === item.id;
    return (
      <Pressable
        onPress={() => onSelect(item)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.handle}, ${compactNumber(item.subscriberCount)} members`}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor:
              pressed || selected ? t.colors.cardPressed : "transparent",
          },
        ]}
      >
        {isHttpUrl(item.icon) ? (
          <Image
            source={{ uri: item.icon }}
            style={[styles.icon, { borderColor: sourceColor }]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.icon,
              styles.iconFallback,
              {
                backgroundColor: t.colors.bgElevated,
                borderColor: sourceColor,
              },
            ]}
          >
            <Ionicons
              name={item.source === "reddit" ? "logo-reddit" : "planet"}
              size={16}
              color={sourceColor}
            />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.handleRow}>
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, fontWeight: "600", flexShrink: 1 },
              ]}
              numberOfLines={1}
            >
              {item.handle}
            </Text>
            <View style={[styles.tag, { backgroundColor: sourceColor }]}>
              <Text style={styles.tagText}>
                {item.source === "reddit" ? "reddit" : "lemmy"}
              </Text>
            </View>
          </View>
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, marginTop: 2 },
            ]}
            numberOfLines={1}
          >
            {compactNumber(item.subscriberCount)} members
            {item.title ? ` · ${item.title}` : ""}
          </Text>
        </View>
        {selected ? (
          <Ionicons name="checkmark-circle" size={20} color={t.colors.accent} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: t.colors.bg, zIndex: 100 },
      ]}
    >
      <SafeAreaView style={styles.fill}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Text style={[t.type.title, { color: t.colors.text }]}>
            Choose a community
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Close community picker"
          >
            <Ionicons name="close" size={24} color={t.colors.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.searchWrap}>
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
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="search"
                placeholder={
                  scope === "all"
                    ? "Search Reddit + Lemmy communities"
                    : scope === "reddit"
                      ? "Search subreddits"
                      : "Search communities"
                }
                placeholderTextColor={t.colors.textTertiary}
                style={[
                  t.type.body,
                  styles.searchInput,
                  { color: t.colors.text },
                ]}
                accessibilityLabel="Search communities"
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

          {/* "Home" / clear-selection shortcut, like a feed's default listing. */}
          <Pressable
            onPress={() => onSelect(null)}
            accessibilityRole="button"
            accessibilityLabel="Clear community filter, show the default feed"
            style={({ pressed }) => [
              styles.homeRow,
              {
                borderBottomColor: t.colors.border,
                backgroundColor: pressed ? t.colors.cardPressed : "transparent",
              },
            ]}
          >
            <Ionicons name="home" size={18} color={t.colors.accent} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, marginLeft: 12, flex: 1 },
              ]}
            >
              Default feed
            </Text>
            {!current ? (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={t.colors.accent}
              />
            ) : null}
          </Pressable>

          {loading ? (
            <ActivityIndicator
              color={t.colors.accent}
              style={{ marginTop: 28 }}
            />
          ) : error ? (
            <Text
              style={[
                t.type.meta,
                {
                  color: t.colors.danger,
                  textAlign: "center",
                  marginTop: 28,
                  paddingHorizontal: 24,
                },
              ]}
            >
              {error}
            </Text>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(c) => c.id}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={
                query.trim().length >= 2 ? (
                  <Text
                    style={[
                      t.type.meta,
                      {
                        color: t.colors.textTertiary,
                        textAlign: "center",
                        marginTop: 28,
                      },
                    ]}
                  >
                    No communities found.
                  </Text>
                ) : (
                  <Text
                    style={[
                      t.type.meta,
                      {
                        color: t.colors.textTertiary,
                        textAlign: "center",
                        marginTop: 28,
                        paddingHorizontal: 24,
                      },
                    ]}
                  >
                    Type to search for a community to browse.
                  </Text>
                )
              }
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchWrap: { padding: 16, paddingBottom: 8 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, marginLeft: 8, paddingVertical: 0 },
  homeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  icon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5 },
  iconFallback: { alignItems: "center", justifyContent: "center" },
  handleRow: { flexDirection: "row", alignItems: "center" },
  tag: {
    marginLeft: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tagText: {
    color: "#fff",
    fontWeight: "700",
    textTransform: "uppercase",
    fontSize: 9,
    letterSpacing: 0.3,
  },
});
