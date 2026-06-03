import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useTheme } from "../theme";
import { loadRecentEmoji, recordRecentEmoji } from "../recentEmoji";
import type { CustomEmoji } from "../../core/model";

const RECENT = "Recent";
const POPULAR = "Popular";

/** Rank a category's emoji: those in `popular` first (in popularity order). */
function orderByPopularity(
  list: CustomEmoji[],
  popularIndex: Map<string, number>,
): CustomEmoji[] {
  return [...list].sort((a, b) => {
    const ai = popularIndex.has(a.shortcode)
      ? popularIndex.get(a.shortcode)!
      : Infinity;
    const bi = popularIndex.has(b.shortcode)
      ? popularIndex.get(b.shortcode)!
      : Infinity;
    if (ai !== bi) return ai - bi;
    return a.shortcode.localeCompare(b.shortcode);
  });
}

/** Filter emoji by a query over shortcode / keywords / alt text / category. */
export function filterEmoji(
  emojis: CustomEmoji[],
  query: string,
): CustomEmoji[] {
  const q = query.trim().toLowerCase();
  if (!q) return emojis;
  return emojis.filter(
    (e) =>
      e.shortcode.toLowerCase().includes(q) ||
      e.altText?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q) ||
      e.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}

const COLS = 6;

/**
 * Custom-emoji picker for the composer. Thousands of emoji, so it's a
 * virtualized grid with a search box and category tabs; a data-derived
 * "Popular" tab leads. Tapping inserts the emoji's markdown and keeps the
 * picker open for rapid multi-insert.
 */
export function EmojiPicker({
  emojis,
  popular,
  instance,
  onSelect,
  onClose,
}: {
  emojis: CustomEmoji[];
  popular: string[];
  /** Instance to key the on-device "Recent" list by. Omit to disable recents. */
  instance?: string;
  onSelect: (emoji: CustomEmoji) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  // Load this instance's recently-used emoji once.
  useEffect(() => {
    let cancelled = false;
    if (instance)
      loadRecentEmoji(instance).then((r) => !cancelled && setRecent(r));
    return () => {
      cancelled = true;
    };
  }, [instance]);

  const byCode = useMemo(
    () => new Map(emojis.map((e) => [e.shortcode, e])),
    [emojis],
  );
  const recentList = useMemo(
    () => recent.map((s) => byCode.get(s)).filter(Boolean) as CustomEmoji[],
    [recent, byCode],
  );

  const [tab, setTab] = useState<string>(recentList.length ? RECENT : POPULAR);

  const popularIndex = useMemo(
    () => new Map(popular.map((s, i) => [s, i])),
    [popular],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of emojis) if (e.category) set.add(e.category);
    return [
      ...(recentList.length ? [RECENT] : []),
      POPULAR,
      ...Array.from(set).sort(),
    ];
  }, [emojis, recentList.length]);

  const popularList = useMemo(() => {
    const ranked = popular
      .map((s) => byCode.get(s))
      .filter(Boolean) as CustomEmoji[];
    // If we have no/low ranking data, fall back to the first chunk so the tab
    // isn't empty.
    return ranked.length >= 8 ? ranked : emojis.slice(0, 48);
  }, [emojis, popular, byCode]);

  const select = (e: CustomEmoji) => {
    if (instance) recordRecentEmoji(instance, e.shortcode).then(setRecent);
    onSelect(e);
  };

  const searching = query.trim().length > 0;
  const grid: CustomEmoji[] = useMemo(() => {
    if (searching) return filterEmoji(emojis, query);
    if (tab === RECENT) return recentList;
    if (tab === POPULAR) return popularList;
    return orderByPopularity(
      emojis.filter((e) => e.category === tab),
      popularIndex,
    );
  }, [searching, query, tab, emojis, recentList, popularList, popularIndex]);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.backdrop,
        { backgroundColor: t.colors.overlay },
      ]}
    >
      <SafeAreaView
        edges={["bottom"]}
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
          },
        ]}
      >
        <View style={styles.bar}>
          <View
            style={[
              styles.search,
              {
                backgroundColor: t.colors.bg,
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
              },
            ]}
          >
            <Ionicons name="search" size={15} color={t.colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Search emoji"
              placeholderTextColor={t.colors.textTertiary}
              style={[
                t.type.meta,
                styles.searchInput,
                { color: t.colors.text },
              ]}
              accessibilityLabel="Search emoji"
            />
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close emoji picker"
            style={{ marginLeft: 10 }}
          >
            <Ionicons name="close" size={22} color={t.colors.text} />
          </Pressable>
        </View>

        {!searching ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsWrap}
            contentContainerStyle={{ paddingHorizontal: 8, gap: 6 }}
          >
            {categories.map((c) => {
              const active = c === tab;
              return (
                <Pressable
                  key={c}
                  onPress={() => setTab(c)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={c}
                  style={[
                    styles.tab,
                    { borderRadius: t.radius.pill },
                    active
                      ? { backgroundColor: t.colors.accentActive }
                      : { backgroundColor: t.colors.bg },
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
                    numberOfLines={1}
                  >
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={styles.gridWrap}>
          <FlashList
            data={grid}
            numColumns={COLS}
            keyExtractor={(e) => e.shortcode}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => select(item)}
                accessibilityRole="button"
                accessibilityLabel={`:${item.shortcode}:`}
                style={styles.cell}
              >
                <Image
                  source={{ uri: item.url }}
                  style={styles.emoji}
                  contentFit="contain"
                  recyclingKey={item.shortcode}
                  cachePolicy="memory-disk"
                />
              </Pressable>
            )}
            ListEmptyComponent={
              <Text
                style={[
                  t.type.meta,
                  {
                    color: t.colors.textTertiary,
                    textAlign: "center",
                    marginTop: 24,
                  },
                ]}
              >
                No emoji found.
              </Text>
            }
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { zIndex: 300, justifyContent: "flex-end" },
  sheet: {
    height: "55%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, marginLeft: 6, paddingVertical: 0 },
  tabsWrap: { flexGrow: 0, maxHeight: 40 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, maxWidth: 180 },
  gridWrap: { flex: 1, paddingHorizontal: 6 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  emoji: { width: 38, height: 38 },
});
