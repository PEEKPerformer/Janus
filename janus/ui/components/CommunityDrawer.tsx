import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { isHttpUrl } from "../links";
import { compactNumber } from "../format";
import {
  buildOriginChips,
  filterByOrigin,
  sortCommunities,
  dedupeCommunities,
} from "../drawerData";
import {
  loadFavorites,
  type CommunityVisit,
} from "../../app/communityAffinity";
import type { Community } from "../../core/model";
import type { FeedGroup } from "../../app/feedGroups";
import type { FeedMode } from "../feedSources";

const SCREEN = Dimensions.get("window").width;
const WIDTH = Math.min(SCREEN * 0.86, 360);
const EDGE = 24; // left-edge grab strip

const SCOPES: {
  mode: FeedMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { mode: "subscribed", label: "Subscribed", icon: "checkmark-done" },
  { mode: "all", label: "All", icon: "layers" },
  { mode: "local", label: "Local", icon: "home" },
];

/**
 * Left-edge swipe + hamburger community drawer. Built on core PanResponder +
 * Animated (no extra native deps). Controlled by the feed screen (`open` /
 * `onOpenChange`) so a header hamburger and the edge swipe share one drawer.
 *
 * The content embodies reddit/lemmy harmony: feed scopes spanning every account,
 * cross-source groups, and ONE merged list of the communities you follow across
 * Reddit and all Lemmy instances — badged by origin and narrowable with an
 * origin filter, never split into source tabs. Accounts/settings live in the
 * footer so the top bar stays clean.
 */
export function CommunityDrawer({
  open,
  onOpenChange,
  groups,
  currentMode,
  currentGroupId,
  currentCommunityId,
  hasActiveSelection,
  onSelectScope,
  onSelectGroup,
  onSelectCommunity,
  onSelectFavorite,
  onOpenSearch,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: FeedGroup[];
  currentMode: FeedMode;
  currentGroupId?: string;
  currentCommunityId?: string;
  /** A community or group is pinned, so no scope chip is "current". */
  hasActiveSelection: boolean;
  onSelectScope: (mode: FeedMode) => void;
  onSelectGroup: (group: FeedGroup) => void;
  onSelectCommunity: (community: Community) => void;
  /** Auto-favorite (a usage-ranked community snapshot) was tapped. */
  onSelectFavorite: (favorite: CommunityVisit) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { manager, accounts, accountVersion } = useAdapters();

  const tx = useRef(new Animated.Value(open ? 0 : -WIDTH)).current;
  const [everOpened, setEverOpened] = useState(open);
  const [origin, setOrigin] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setEverOpened(true);
    else setQuery(""); // reset the filter when the drawer closes
    Animated.timing(tx, {
      toValue: open ? 0 : -WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [open, tx]);

  // Lazily load subscriptions across EVERY signed-in account once opened.
  const { data: subs } = useAsync<Community[]>(async () => {
    if (!everOpened) return [];
    const signedIn = manager.signedInAdapters();
    if (signedIn.length === 0) return [];
    const settled = await Promise.allSettled(
      signedIn.map((a) => a.getSubscriptions()),
    );
    const all = settled.flatMap((r) =>
      r.status === "fulfilled" ? r.value : [],
    );
    return dedupeCommunities(all);
  }, [everOpened, accountVersion]);

  // Auto-favorites: usage-ranked communities, refreshed each time the drawer opens.
  const { data: favs } = useAsync<CommunityVisit[]>(async () => {
    if (!everOpened) return [];
    return loadFavorites(Date.now(), 6);
  }, [everOpened, open, accountVersion]);
  const favorites = favs ?? [];

  const subscriptions = subs ?? [];
  const chips = useMemo(() => buildOriginChips(subscriptions), [subscriptions]);
  const visible = useMemo(() => {
    const byOrigin = filterByOrigin(subscriptions, origin);
    const q = query.trim().toLowerCase();
    const matched = q
      ? byOrigin.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.handle.toLowerCase().includes(q),
        )
      : byOrigin;
    return sortCommunities(matched);
  }, [subscriptions, origin, query]);

  const edgePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        tx.setValue(Math.min(0, -WIDTH + Math.max(0, g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > WIDTH * 0.33) onOpenChange(true);
        else
          Animated.timing(tx, {
            toValue: -WIDTH,
            duration: 160,
            useNativeDriver: true,
          }).start();
      },
    }),
  ).current;

  const close = () => onOpenChange(false);
  const choose = (fn: () => void) => {
    fn();
    close();
  };

  const scrimOpacity = tx.interpolate({
    inputRange: [-WIDTH, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const accountLine =
    accounts.length === 0
      ? "Browsing as guest"
      : accounts.length === 1
        ? accounts[0].username
        : `${accounts.length} accounts`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Grab strip — only the leftmost sliver, so the feed scrolls normally. */}
      {!open ? (
        <View
          {...edgePan.panHandlers}
          style={[styles.edge, { width: EDGE }]}
          accessibilityRole="button"
          accessibilityLabel="Open communities drawer"
        />
      ) : null}

      {/* Scrim */}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: t.colors.overlay, opacity: scrimOpacity },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close communities drawer"
        />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          styles.panel,
          {
            width: WIDTH,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom,
            backgroundColor: t.colors.bgElevated,
            borderRightColor: t.colors.border,
            transform: [{ translateX: tx }],
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Account header → Settings */}
          <Pressable
            onPress={() => choose(onOpenSettings)}
            accessibilityRole="button"
            accessibilityLabel="Accounts and settings"
            style={({ pressed }) => [
              styles.acctRow,
              {
                borderBottomColor: t.colors.border,
                backgroundColor: pressed ? t.colors.cardPressed : "transparent",
              },
            ]}
          >
            <Ionicons name="person-circle" size={30} color={t.colors.accent} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, fontWeight: "700" },
                ]}
                numberOfLines={1}
              >
                {accountLine}
              </Text>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                Accounts & settings
              </Text>
            </View>
            <Ionicons
              name="settings-outline"
              size={20}
              color={t.colors.textSecondary}
            />
          </Pressable>

          {/* Auto-favorites — the communities you actually use, ranked for you */}
          {favorites.length > 0 ? (
            <>
              <Text
                style={[
                  t.type.small,
                  styles.header,
                  { color: t.colors.textTertiary },
                ]}
              >
                FAVORITES
              </Text>
              {favorites.map((f) => {
                const color =
                  f.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
                const badge = f.source === "reddit" ? "reddit" : f.instance;
                return (
                  <Pressable
                    key={`fav-${f.id}`}
                    onPress={() => choose(() => onSelectFavorite(f))}
                    accessibilityRole="button"
                    accessibilityLabel={`Favorite: ${f.handle} on ${badge}`}
                    accessibilityState={{
                      selected: f.id === currentCommunityId,
                    }}
                    style={({ pressed }) => [
                      styles.commRow,
                      {
                        backgroundColor: pressed
                          ? t.colors.cardPressed
                          : "transparent",
                      },
                    ]}
                  >
                    {isHttpUrl(f.icon) ? (
                      <Image
                        source={{ uri: f.icon }}
                        style={[styles.icon, { borderColor: color }]}
                        contentFit="cover"
                      />
                    ) : (
                      <View
                        style={[
                          styles.icon,
                          styles.iconFallback,
                          { backgroundColor: t.colors.bg, borderColor: color },
                        ]}
                      >
                        <Ionicons
                          name={
                            f.source === "reddit" ? "logo-reddit" : "planet"
                          }
                          size={13}
                          color={color}
                        />
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        style={[
                          t.type.meta,
                          { color: t.colors.text, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                      >
                        {f.name}
                      </Text>
                      <Text
                        style={[t.type.small, { color: t.colors.textTertiary }]}
                        numberOfLines={1}
                      >
                        {badge}
                      </Text>
                    </View>
                    <Ionicons name="star" size={13} color={t.colors.accent} />
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* Scopes — span every account */}
          {SCOPES.map((s) => {
            const active = !hasActiveSelection && currentMode === s.mode;
            return (
              <Pressable
                key={s.mode}
                onPress={() => choose(() => onSelectScope(s.mode))}
                accessibilityRole="button"
                accessibilityLabel={`${s.label} feed`}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed
                      ? t.colors.cardPressed
                      : "transparent",
                  },
                ]}
              >
                <Ionicons name={s.icon} size={18} color={t.colors.accent} />
                <Text
                  style={[
                    t.type.body,
                    styles.rowLabel,
                    { color: t.colors.text },
                  ]}
                >
                  {s.label}
                </Text>
                {active ? (
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={t.colors.accent}
                  />
                ) : null}
              </Pressable>
            );
          })}

          {/* Groups */}
          {groups.length > 0 ? (
            <Text
              style={[
                t.type.small,
                styles.header,
                { color: t.colors.textTertiary },
              ]}
            >
              GROUPS
            </Text>
          ) : null}
          {groups.map((g) => {
            const active = g.id === currentGroupId;
            return (
              <Pressable
                key={g.id}
                onPress={() => choose(() => onSelectGroup(g))}
                accessibilityRole="button"
                accessibilityLabel={`${g.name} group`}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed
                      ? t.colors.cardPressed
                      : "transparent",
                  },
                ]}
              >
                <Ionicons
                  name="albums-outline"
                  size={18}
                  color={t.colors.lemmy}
                />
                <Text
                  style={[
                    t.type.body,
                    styles.rowLabel,
                    { color: t.colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {g.name}
                </Text>
                <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                  {g.members.length}
                </Text>
              </Pressable>
            );
          })}

          {/* Communities — merged across sources, origin-filterable */}
          <Text
            style={[
              t.type.small,
              styles.header,
              { color: t.colors.textTertiary },
            ]}
          >
            YOUR COMMUNITIES
          </Text>
          {subscriptions.length === 0 ? (
            <Text
              style={[
                t.type.meta,
                styles.empty,
                { color: t.colors.textTertiary },
              ]}
            >
              Communities you follow across Reddit and your Lemmy instances show
              up here. Tap Search to find more.
            </Text>
          ) : (
            <>
              <View
                style={[
                  styles.searchBox,
                  {
                    backgroundColor: t.colors.bg,
                    borderColor: t.colors.border,
                    borderRadius: t.radius.md,
                  },
                ]}
              >
                <Ionicons
                  name="search"
                  size={15}
                  color={t.colors.textTertiary}
                />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Filter your communities"
                  placeholderTextColor={t.colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Filter subscribed communities"
                  style={[styles.searchInput, { color: t.colors.text }]}
                />
                {query ? (
                  <Pressable
                    onPress={() => setQuery("")}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear filter"
                  >
                    <Ionicons
                      name="close-circle"
                      size={16}
                      color={t.colors.textTertiary}
                    />
                  </Pressable>
                ) : null}
              </View>
              {chips.length > 2 && !query ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {chips.map((c) => {
                    const active = c.key === origin;
                    return (
                      <Pressable
                        key={c.key}
                        onPress={() => setOrigin(c.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`Filter to ${c.label}`}
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.chip,
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
                          {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
              {visible.map((c) => {
                const selected = c.id === currentCommunityId;
                const color =
                  c.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
                const badge = c.source === "reddit" ? "reddit" : c.instance;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => choose(() => onSelectCommunity(c))}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.handle} on ${badge}`}
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.commRow,
                      {
                        backgroundColor:
                          pressed || selected
                            ? t.colors.cardPressed
                            : "transparent",
                      },
                    ]}
                  >
                    {isHttpUrl(c.icon) ? (
                      <Image
                        source={{ uri: c.icon }}
                        style={[styles.icon, { borderColor: color }]}
                        contentFit="cover"
                      />
                    ) : (
                      <View
                        style={[
                          styles.icon,
                          styles.iconFallback,
                          { backgroundColor: t.colors.bg, borderColor: color },
                        ]}
                      >
                        <Ionicons
                          name={
                            c.source === "reddit" ? "logo-reddit" : "planet"
                          }
                          size={13}
                          color={color}
                        />
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        style={[
                          t.type.meta,
                          { color: t.colors.text, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                      >
                        {c.name}
                      </Text>
                      <Text
                        style={[t.type.small, { color: t.colors.textTertiary }]}
                        numberOfLines={1}
                      >
                        {badge}
                        {c.subscriberCount
                          ? ` · ${compactNumber(c.subscriberCount)}`
                          : ""}
                      </Text>
                    </View>
                    <View
                      style={[styles.originDot, { backgroundColor: color }]}
                    />
                  </Pressable>
                );
              })}
              {query && visible.length === 0 ? (
                <Text
                  style={[
                    t.type.meta,
                    styles.empty,
                    { color: t.colors.textTertiary },
                  ]}
                >
                  No subscribed communities match “{query.trim()}”. Tap Search
                  to find more.
                </Text>
              ) : null}
            </>
          )}

          <Pressable
            onPress={() => choose(onOpenSearch)}
            accessibilityRole="button"
            accessibilityLabel="Search all communities"
            style={({ pressed }) => [
              styles.row,
              styles.searchRow,
              {
                borderTopColor: t.colors.border,
                backgroundColor: pressed ? t.colors.cardPressed : "transparent",
              },
            ]}
          >
            <Ionicons name="search" size={18} color={t.colors.accent} />
            <Text
              style={[t.type.body, styles.rowLabel, { color: t.colors.accent }]}
            >
              Search all communities
            </Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, top: 0, bottom: 0 },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  acctRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowLabel: { flex: 1, marginLeft: 12 },
  searchRow: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  empty: { paddingHorizontal: 16, paddingVertical: 8, lineHeight: 18 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 2,
    paddingHorizontal: 10,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: { flex: 1, paddingVertical: 0, fontSize: 14 },
  chipRow: { paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, maxWidth: 150 },
  commRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  icon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5 },
  iconFallback: { alignItems: "center", justifyContent: "center" },
  originDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 8 },
});
