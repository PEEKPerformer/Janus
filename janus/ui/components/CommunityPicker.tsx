import React, { useCallback, useEffect, useRef, useState } from "react";
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
import type { SourceKind } from "../../core/ids";
import type { FeedGroup } from "../../app/feedGroups";
import { useTheme } from "../theme";
import { compactNumber } from "../format";
import { isHttpUrl } from "../links";
import { interleave } from "../unifiedFeed";

/** The user's selection: a community, the default feed (null), or the subscribed home. */
export type CommunitySelection = Community | null | "subscribed";

/**
 * Community picker + sidebar. Searches subreddits and Lemmy communities (both
 * sources in "All" scope, tagged); also lists the signed-in user's subscribed
 * communities and offers a "Subscribed" home feed — the navigation surface both
 * Hydra and Voyager center on. Each row has a follow/unfollow toggle.
 */
export function CommunityPicker({
  adapters,
  scope,
  current,
  subscribedActive,
  groups = [],
  currentGroupId,
  onSelectGroup,
  onSelect,
  onClose,
}: {
  adapters: AdapterMap;
  scope: FeedScope;
  current?: Community | null;
  subscribedActive?: boolean;
  /** Cross-source feed groups to offer above search results. */
  groups?: FeedGroup[];
  currentGroupId?: string;
  onSelectGroup?: (group: FeedGroup) => void;
  onSelect: (sel: CommunitySelection) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Community[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [subs, setSubs] = useState<Community[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  const sourcesInScope: SourceKind[] =
    scope === "all" ? ["reddit", "lemmy"] : [scope];
  const signedInScope = sourcesInScope.filter(
    (s) => !adapters[s].account.isGuest,
  );
  const canSubscribed = signedInScope.length > 0;

  // Load the user's subscribed communities (the sidebar list).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canSubscribed) {
        setSubs([]);
        return;
      }
      const settled = await Promise.allSettled(
        signedInScope.map((s) => adapters[s].getSubscriptions()),
      );
      if (cancelled) return;
      const all = settled.flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      setSubs(all);
      setFollowing(new Set(all.map((c) => c.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Debounced search.
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
          sourcesInScope.map((s) =>
            adapters[s].searchCommunities(q, { limit: 25 }),
          ),
        );
        if (id !== reqId.current) return;
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
  }, [query, scope]);

  const toggleFollow = useCallback(
    async (community: Community) => {
      if (adapters[community.source].account.isGuest) return;
      const next = !following.has(community.id);
      setFollowing((prev) => {
        const s = new Set(prev);
        if (next) s.add(community.id);
        else s.delete(community.id);
        return s;
      });
      try {
        await adapters[community.source].setSubscription(community.id, next);
      } catch {
        setFollowing((prev) => {
          const s = new Set(prev);
          if (next) s.delete(community.id);
          else s.add(community.id);
          return s;
        });
      }
    },
    [adapters, following],
  );

  const searching = query.trim().length >= 2;
  const listData = searching ? results : subs;

  const renderItem = ({ item }: { item: Community }) => {
    const sourceColor =
      item.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
    const selected = current?.id === item.id;
    const isFollowing = following.has(item.id);
    const canFollow = !adapters[item.source].account.isGuest;
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
              <Text style={styles.tagText} numberOfLines={1}>
                {item.source === "reddit" ? "reddit" : item.instance}
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
        {canFollow ? (
          <Pressable
            onPress={() => toggleFollow(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              isFollowing ? `Unfollow ${item.handle}` : `Follow ${item.handle}`
            }
            style={[
              styles.followBtn,
              {
                borderColor: isFollowing ? t.colors.border : sourceColor,
                borderRadius: t.radius.pill,
              },
            ]}
          >
            <Ionicons
              name={isFollowing ? "checkmark" : "add"}
              size={16}
              color={isFollowing ? t.colors.textSecondary : sourceColor}
            />
          </Pressable>
        ) : selected ? (
          <Ionicons name="checkmark-circle" size={20} color={t.colors.accent} />
        ) : null}
      </Pressable>
    );
  };

  const renderSpecialRow = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    active: boolean,
    onPress: () => void,
    a11y: string,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.homeRow,
        {
          borderBottomColor: t.colors.border,
          backgroundColor: pressed ? t.colors.cardPressed : "transparent",
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={t.colors.accent} />
      <Text
        style={[t.type.body, { color: t.colors.text, marginLeft: 12, flex: 1 }]}
      >
        {label}
      </Text>
      {active ? (
        <Ionicons name="checkmark-circle" size={20} color={t.colors.accent} />
      ) : null}
    </Pressable>
  );

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
            Communities
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

          {!searching ? (
            <>
              {renderSpecialRow(
                "home",
                "Default feed",
                !current && !subscribedActive,
                () => onSelect(null),
                "Clear community filter, show the default feed",
              )}
              {canSubscribed
                ? renderSpecialRow(
                    "checkmark-done",
                    "Subscribed",
                    !!subscribedActive,
                    () => onSelect("subscribed"),
                    "Show your subscribed feed",
                  )
                : null}
              {onSelectGroup && groups.length > 0 ? (
                <Text
                  style={[
                    t.type.small,
                    styles.sectionHeader,
                    { color: t.colors.textTertiary },
                  ]}
                >
                  GROUPS
                </Text>
              ) : null}
              {onSelectGroup
                ? groups.map((g) => (
                    <React.Fragment key={g.id}>
                      {renderSpecialRow(
                        "albums-outline",
                        `${g.name}  ·  ${g.members.length}`,
                        g.id === currentGroupId,
                        () => onSelectGroup(g),
                        `Show the ${g.name} group feed`,
                      )}
                    </React.Fragment>
                  ))
                : null}
            </>
          ) : null}

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
              data={listData}
              keyExtractor={(c) => c.id}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListHeaderComponent={
                !searching && subs.length > 0 ? (
                  <Text
                    style={[
                      t.type.small,
                      styles.sectionHeader,
                      { color: t.colors.textTertiary },
                    ]}
                  >
                    YOUR COMMUNITIES
                  </Text>
                ) : null
              }
              ListEmptyComponent={
                searching ? (
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
                    {canSubscribed
                      ? "You haven't joined any communities yet. Search to find some."
                      : "Search for a community to browse, or sign in to see your subscriptions."}
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
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    fontWeight: "700",
    letterSpacing: 0.5,
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
    maxWidth: 120,
    flexShrink: 0,
  },
  tagText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.2,
  },
  followBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
