import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import { useAsync, useCachedAsync } from "../hooks";
import { createSwrCache } from "../../app/swrCache";
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
  pinCommunity,
  unpinCommunity,
  removeFavorite,
  type CommunityVisit,
  type FavoriteEntry,
} from "../../app/communityAffinity";
import { QuickSwitchSheet } from "./QuickSwitchSheet";
import type { Community, Multireddit } from "../../core/model";
import type { FeedGroup } from "../../app/feedGroups";
import type { FeedMode } from "../feedSources";

const SCREEN = Dimensions.get("window").width;
const WIDTH = Math.min(SCREEN * 0.86, 360);
const EDGE = 24; // left-edge grab strip

// Subscriptions rarely change, so cache them on disk and revalidate in the
// background — the drawer paints your communities instantly on a warm launch.
const SUBS_CACHE = createSwrCache("janus.subscriptions.v1");
const SUBS_TTL_MS = 6 * 60 * 60 * 1000; // 6h before a stale badge; always revalidates

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
  onSelectMulti,
  onSelectFavorite,
  onOpenSearch,
  onOpenSettings,
  onOpenProfile,
  onOpenReadLater,
  readLaterCount = 0,
  onOpenWatches,
  onOpenPlaneMode,
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
  /** A Reddit multireddit was tapped (scopes the feed to it). */
  onSelectMulti?: (multi: Multireddit) => void;
  /** Auto-favorite (a usage-ranked community snapshot) was tapped. */
  onSelectFavorite: (favorite: CommunityVisit) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  /** Open the signed-in user's own profile (absent when browsing as guest). */
  onOpenProfile?: () => void;
  /** Open the local Read Later queue (works for guests too). */
  onOpenReadLater?: () => void;
  readLaterCount?: number;
  /** Open the saved-searches ("watches") list. */
  onOpenWatches?: () => void;
  /** Open Plane Mode (pack threads + images for offline reading). */
  onOpenPlaneMode?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { manager, accounts, accountVersion, requestLogin } = useAdapters();
  const [switchOpen, setSwitchOpen] = useState(false);

  const tx = useRef(new Animated.Value(open ? 0 : -WIDTH)).current;
  const [everOpened, setEverOpened] = useState(open);
  const [origin, setOrigin] = useState("all");
  const [query, setQuery] = useState("");
  // Bumped after a manual pin/remove so the favorites list re-reads.
  const [favVersion, setFavVersion] = useState(0);

  useEffect(() => {
    if (open) setEverOpened(true);
    else setQuery(""); // reset the filter when the drawer closes
    Animated.timing(tx, {
      toValue: open ? 0 : -WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [open, tx]);

  // Subscriptions across EVERY signed-in account, cached per account-set so the
  // list shows immediately on open and reconciles (new subs appear, removed ones
  // drop) from a quiet background refetch. Key is null until opened / when signed
  // out, which idles the fetch.
  const signedInKey = useMemo(
    () =>
      manager
        .signedInAdapters()
        .map((a) => a.account.id)
        .sort()
        .join("|"),
    // accountVersion changes when an account is added/removed.

    [accountVersion],
  );
  const subsCacheKey = everOpened && signedInKey ? `subs:${signedInKey}` : null;
  const { data: subs, revalidating: subsRevalidating } = useCachedAsync<
    Community[]
  >(
    SUBS_CACHE,
    subsCacheKey,
    SUBS_TTL_MS,
    async () => {
      const signedIn = manager.signedInAdapters();
      if (signedIn.length === 0) return [];
      const settled = await Promise.allSettled(
        signedIn.map((a) => a.getSubscriptions()),
      );
      const all = settled.flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      return dedupeCommunities(all);
    },
    [everOpened, accountVersion],
  );

  // Favorites: manual pins first, then usage-ranked auto picks. Refreshed each
  // time the drawer opens and after any manual pin/remove.
  const { data: favs } = useAsync<FavoriteEntry[]>(async () => {
    if (!everOpened) return [];
    return loadFavorites(Date.now(), 6);
  }, [everOpened, open, accountVersion, favVersion]);
  const favorites = favs ?? [];
  const pinnedIds = useMemo(
    () => new Set(favorites.filter((f) => f.pinned).map((f) => f.id)),
    [favorites],
  );

  const refreshFavorites = () => setFavVersion((v) => v + 1);
  const removeFav = (id: string) => {
    void removeFavorite(id).then(refreshFavorites);
  };
  const togglePin = (c: Community) => {
    const op = pinnedIds.has(c.id)
      ? unpinCommunity(c.id)
      : pinCommunity(
          {
            id: c.id,
            source: c.source,
            instance: c.instance,
            name: c.name,
            handle: c.handle,
            icon: c.icon,
          },
          Date.now(),
        );
    void op.then(refreshFavorites);
  };

  // Reddit multireddits (curated subreddit collections), when signed in.
  const [multiVersion, setMultiVersion] = useState(0);
  const { data: multis } = useAsync<Multireddit[]>(async () => {
    if (!everOpened || !onSelectMulti) return [];
    const reddit = manager.reddit();
    if (reddit.account.isGuest || !reddit.getMultireddits) return [];
    try {
      return await reddit.getMultireddits();
    } catch {
      return [];
    }
  }, [everOpened, accountVersion, multiVersion]);
  const multireddits = multis ?? [];
  const reddit = manager.reddit();
  const canManageMultis =
    !!onSelectMulti && !reddit.account.isGuest && !!reddit.createMultireddit;

  const newMultireddit = () => {
    Alert.prompt?.("New multireddit", "Name", async (name) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed || !reddit.createMultireddit) return;
      try {
        await reddit.createMultireddit(trimmed);
        setMultiVersion((v) => v + 1);
      } catch {
        Alert.alert("Couldn't create", "Try a different name.");
      }
    });
  };
  const deleteMultireddit = (m: Multireddit) => {
    Alert.alert("Delete multireddit", `Delete "${m.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!reddit.deleteMultireddit) return;
          try {
            await reddit.deleteMultireddit(m.id);
            setMultiVersion((v) => v + 1);
          } catch {
            /* leave the list as-is on failure */
          }
        },
      },
    ]);
  };

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
          {/* Account header → quick switch tray */}
          <Pressable
            onPress={() => setSwitchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Switch account or scope"
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

          {/* Your profile (incl. Saved) — only when signed in. */}
          {onOpenProfile && accounts.length > 0 ? (
            <Pressable
              onPress={() => choose(onOpenProfile)}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              style={({ pressed }) => [
                styles.commRow,
                {
                  backgroundColor: pressed
                    ? t.colors.cardPressed
                    : "transparent",
                },
              ]}
            >
              <Ionicons
                name="bookmark-outline"
                size={18}
                color={t.colors.textSecondary}
                style={{ marginLeft: 2 }}
              />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, marginLeft: 12, flex: 1 },
                ]}
              >
                Your profile & saved
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={t.colors.textTertiary}
              />
            </Pressable>
          ) : null}

          {/* Read Later — the local queue, available even as a guest. */}
          {onOpenReadLater ? (
            <Pressable
              onPress={() => choose(onOpenReadLater)}
              accessibilityRole="button"
              accessibilityLabel={`Read later, ${readLaterCount} queued`}
              style={({ pressed }) => [
                styles.commRow,
                {
                  backgroundColor: pressed
                    ? t.colors.cardPressed
                    : "transparent",
                },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={18}
                color={t.colors.textSecondary}
                style={{ marginLeft: 2 }}
              />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, marginLeft: 12, flex: 1 },
                ]}
              >
                Read later
              </Text>
              {readLaterCount > 0 ? (
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.accent, fontWeight: "700" },
                  ]}
                >
                  {readLaterCount}
                </Text>
              ) : null}
              <Ionicons
                name="chevron-forward"
                size={16}
                color={t.colors.textTertiary}
                style={{ marginLeft: 6 }}
              />
            </Pressable>
          ) : null}

          {/* Saved searches — the local keyword-watch list. */}
          {onOpenWatches ? (
            <Pressable
              onPress={() => choose(onOpenWatches)}
              accessibilityRole="button"
              accessibilityLabel="Saved searches"
              style={({ pressed }) => [
                styles.commRow,
                {
                  backgroundColor: pressed
                    ? t.colors.cardPressed
                    : "transparent",
                },
              ]}
            >
              <Ionicons
                name="notifications-outline"
                size={18}
                color={t.colors.textSecondary}
                style={{ marginLeft: 2 }}
              />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, marginLeft: 12, flex: 1 },
                ]}
              >
                Saved searches
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={t.colors.textTertiary}
              />
            </Pressable>
          ) : null}

          {/* Plane Mode — pack your reading before a flight. */}
          {onOpenPlaneMode ? (
            <Pressable
              onPress={() => choose(onOpenPlaneMode)}
              accessibilityRole="button"
              accessibilityLabel="Plane mode"
              style={({ pressed }) => [
                styles.commRow,
                {
                  backgroundColor: pressed
                    ? t.colors.cardPressed
                    : "transparent",
                },
              ]}
            >
              <Ionicons
                name="airplane-outline"
                size={18}
                color={t.colors.textSecondary}
                style={{ marginLeft: 2 }}
              />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, marginLeft: 12, flex: 1 },
                ]}
              >
                Plane mode
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={t.colors.textTertiary}
              />
            </Pressable>
          ) : null}

          {/* Find new communities — pinned near the top so it's always reachable
              without scrolling past a long subscription list. */}
          <Pressable
            onPress={() => choose(onOpenSearch)}
            accessibilityRole="button"
            accessibilityLabel="Search for communities to join"
            style={({ pressed }) => [
              styles.searchTop,
              {
                backgroundColor: pressed ? t.colors.cardPressed : t.colors.bg,
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
              },
            ]}
          >
            <Ionicons name="search" size={16} color={t.colors.accent} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, marginLeft: 10, flex: 1 },
              ]}
            >
              Search communities
            </Text>
            <Ionicons name="add" size={18} color={t.colors.accent} />
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
                        {f.pinned ? `${badge} · pinned` : badge}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeFav(f.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${f.handle} from favorites`}
                      style={styles.favAction}
                    >
                      <Ionicons
                        name={f.pinned ? "star" : "star-outline"}
                        size={16}
                        color={t.colors.accent}
                      />
                    </Pressable>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* Reddit multireddits */}
          {onSelectMulti && (multireddits.length > 0 || canManageMultis) ? (
            <>
              <Text
                style={[
                  t.type.small,
                  styles.header,
                  { color: t.colors.textTertiary },
                ]}
              >
                MULTIREDDITS
              </Text>
              {multireddits.map((m) => (
                <Pressable
                  key={`multi-${m.id}`}
                  onPress={() => choose(() => onSelectMulti(m))}
                  onLongPress={
                    canManageMultis ? () => deleteMultireddit(m) : undefined
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Multireddit: ${m.name}, ${m.communities.length} communities`}
                  accessibilityHint={
                    canManageMultis ? "Long press to delete" : undefined
                  }
                  accessibilityState={{ selected: m.id === currentCommunityId }}
                  style={({ pressed }) => [
                    styles.commRow,
                    {
                      backgroundColor: pressed
                        ? t.colors.cardPressed
                        : "transparent",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.icon,
                      styles.iconFallback,
                      {
                        backgroundColor: t.colors.bg,
                        borderColor: t.colors.reddit,
                      },
                    ]}
                  >
                    <Ionicons
                      name="albums-outline"
                      size={13}
                      color={t.colors.reddit}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text
                      style={[
                        t.type.meta,
                        { color: t.colors.text, fontWeight: "600" },
                      ]}
                      numberOfLines={1}
                    >
                      {m.name}
                    </Text>
                    <Text
                      style={[t.type.small, { color: t.colors.textTertiary }]}
                      numberOfLines={1}
                    >
                      {m.communities.length} communities
                    </Text>
                  </View>
                </Pressable>
              ))}
              {canManageMultis ? (
                <Pressable
                  onPress={newMultireddit}
                  accessibilityRole="button"
                  accessibilityLabel="New multireddit"
                  style={({ pressed }) => [
                    styles.commRow,
                    {
                      backgroundColor: pressed
                        ? t.colors.cardPressed
                        : "transparent",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.icon,
                      styles.iconFallback,
                      {
                        backgroundColor: t.colors.bg,
                        borderColor: t.colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="add" size={15} color={t.colors.accent} />
                  </View>
                  <Text
                    style={[
                      t.type.meta,
                      {
                        color: t.colors.accent,
                        marginLeft: 10,
                        fontWeight: "600",
                      },
                    ]}
                  >
                    New multireddit
                  </Text>
                </Pressable>
              ) : null}
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
            {subsRevalidating && subscriptions.length > 0 ? " · updating…" : ""}
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
                    <Pressable
                      onPress={() => togglePin(c)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={
                        pinnedIds.has(c.id)
                          ? `Unpin ${c.handle} from favorites`
                          : `Pin ${c.handle} to favorites`
                      }
                      accessibilityState={{ selected: pinnedIds.has(c.id) }}
                      style={styles.favAction}
                    >
                      <Ionicons
                        name={pinnedIds.has(c.id) ? "star" : "star-outline"}
                        size={16}
                        color={
                          pinnedIds.has(c.id)
                            ? t.colors.accent
                            : t.colors.textTertiary
                        }
                      />
                    </Pressable>
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

      <QuickSwitchSheet
        visible={switchOpen}
        onClose={() => setSwitchOpen(false)}
        onAddAccount={(s) => {
          setSwitchOpen(false);
          close();
          requestLogin(s);
        }}
        onOpenSettings={() => {
          setSwitchOpen(false);
          choose(onOpenSettings);
        }}
      />
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
  favAction: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  originDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 8 },
  searchTop: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
