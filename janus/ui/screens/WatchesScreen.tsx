import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import { relativeTime } from "../format";
import { EmptyView } from "../components/StateViews";
import {
  runWatch,
  runCommentWatch,
  unseenIds,
  type WatchAdapters,
} from "../runWatch";
import {
  initSavedSearches,
  listSavedSearches,
  removeSearch,
  type SavedSearch,
} from "../../app/savedSearches";

type Props = NativeStackScreenProps<RootStackParamList, "Watches">;

const scopeLabel = (s: SavedSearch): string => {
  if (s.kind === "comments") {
    return `${s.communityHandle ?? "thread"} · ${s.seriesLabel ?? "comments"}`;
  }
  return (
    s.communityHandle ??
    (s.source === "all"
      ? "Reddit + Lemmy"
      : s.source === "reddit"
        ? "Reddit"
        : "Lemmy")
  );
};

/**
 * Saved searches — each watch re-runs on focus and badges how many results are
 * NEW since you last opened it. The in-app, no-server take on keyword alerts
 * (live-thread polling pointed at a search). Cross-network: a watch's count
 * spans Reddit and Lemmy together.
 */
export function WatchesScreen({ navigation }: Props) {
  const t = useTheme();
  const { adapters, adapterForEntity } = useAdapters();
  const ctx: WatchAdapters = {
    reddit: adapters.reddit,
    lemmy: adapters.lemmy,
    adapterForEntity,
  };

  const [watches, setWatches] = useState<SavedSearch[]>([]);
  const [counts, setCounts] = useState<Record<string, number | "err" | undefined>>(
    {},
  );
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    await initSavedSearches();
    const list = listSavedSearches();
    setWatches(list);
    if (list.length === 0) return;
    setChecking(true);
    // Fetch each watch's current results and diff against its seen ring.
    const entries = await Promise.all(
      list.map(async (w) => {
        try {
          const ids =
            w.kind === "comments"
              ? (await runCommentWatch(w, ctx)).matches.map((c) => c.id)
              : (await runWatch(w, ctx)).map((p) => p.id);
          return [w.id, unseenIds(w.seenIds, ids.map((id) => ({ id }))).length] as const;
        } catch {
          return [w.id, "err" as const] as const;
        }
      }),
    );
    setCounts(Object.fromEntries(entries));
    setChecking(false);
  }, [adapters.reddit, adapters.lemmy]);

  // Re-check every time the screen regains focus (cheap in-app polling).
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    void initSavedSearches().then(() => setWatches(listSavedSearches()));
  }, []);

  const confirmRemove = (w: SavedSearch) => {
    Alert.alert("Remove watch", `Stop watching "${w.query}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          removeSearch(w.id);
          setWatches(listSavedSearches());
        },
      },
    ]);
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
        <Text
          style={[t.type.title, { color: t.colors.text, flex: 1, marginLeft: 8 }]}
        >
          Saved searches
        </Text>
        {checking ? (
          <ActivityIndicator size="small" color={t.colors.accent} />
        ) : (
          <Pressable
            onPress={() => void refresh()}
            accessibilityRole="button"
            accessibilityLabel="Refresh watches"
            hitSlop={8}
          >
            <Ionicons name="refresh" size={18} color={t.colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <FlashList
        data={watches}
        keyExtractor={(w) => w.id}
        extraData={counts}
        renderItem={({ item }) => {
          const n = counts[item.id];
          return (
            <Pressable
              onPress={() => navigation.navigate("WatchResults", { id: item.id })}
              onLongPress={() => confirmRemove(item)}
              accessibilityRole="button"
              accessibilityLabel={`Watch for ${item.query}${
                typeof n === "number" && n > 0 ? `, ${n} new` : ""
              }. Long-press to remove.`}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? t.colors.cardPressed : t.colors.bg,
                  borderBottomColor: t.colors.border,
                  paddingHorizontal: t.spacing.lg,
                },
              ]}
            >
              <Ionicons
                name="notifications"
                size={18}
                color={
                  typeof n === "number" && n > 0
                    ? t.colors.accent
                    : t.colors.textTertiary
                }
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text
                  style={[t.type.body, { color: t.colors.text, fontWeight: "600" }]}
                  numberOfLines={1}
                >
                  {item.query}
                </Text>
                <Text
                  style={[t.type.small, { color: t.colors.textTertiary, marginTop: 1 }]}
                  numberOfLines={1}
                >
                  {scopeLabel(item)} ·{" "}
                  {item.lastCheckedAt
                    ? `checked ${relativeTime(item.lastCheckedAt)}`
                    : "not checked yet"}
                </Text>
              </View>
              {n === "err" ? (
                <Ionicons
                  name="cloud-offline-outline"
                  size={16}
                  color={t.colors.textTertiary}
                />
              ) : typeof n === "number" && n > 0 ? (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: t.colors.accent, borderRadius: t.radius.pill },
                  ]}
                >
                  <Text style={[t.type.small, { color: "#fff", fontWeight: "700" }]}>
                    {n} new
                  </Text>
                </View>
              ) : n === 0 ? (
                <Ionicons
                  name="checkmark"
                  size={16}
                  color={t.colors.textTertiary}
                />
              ) : (
                <ActivityIndicator size="small" color={t.colors.textTertiary} />
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyView
            title="No saved searches"
            detail="Run a search, then tap the bell to watch it. New matches across Reddit and Lemmy show up here."
            icon="notifications-outline"
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: { paddingHorizontal: 9, paddingVertical: 3 },
});
