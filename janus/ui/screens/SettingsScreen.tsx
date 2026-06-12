import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useSettings } from "../SettingsContext";
import { useTheme, clampHex } from "../theme";
import RedditCookies from "../../sources/reddit/RedditCookies";
import { normalizeInstance } from "../../sources/lemmy/LemmyInstance";
import { parseId } from "../../core/ids";
import type { JanusId } from "../../core/ids";
import type { SwipeActionId, SwipeConfig } from "../../app/settingsStore";
import { ToggleRow, ChoiceRow, StepperRow } from "../components/SettingRows";
import {
  APP_ICON_CHOICES,
  canChangeAppIcon,
  currentAppIcon,
  applyAppIcon,
} from "../../app/appIcon";
import {
  parseCommunityAddress,
  addressLabel,
  saveGroup,
  removeGroup,
  type FeedGroup,
  type CommunityAddress,
} from "../../app/feedGroups";

const POST_SORTS = [
  { id: "hot", label: "Hot" },
  { id: "new", label: "New" },
  { id: "top", label: "Top" },
  { id: "controversial", label: "Controversial" },
] as const;

const COMMENT_SORTS = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
  { id: "old", label: "Old" },
  { id: "controversial", label: "Controversial" },
  { id: "hot", label: "Hot" },
] as const;

const TIME_WINDOWS = [
  { id: "hour", label: "Hour" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "all", label: "All" },
] as const;

const FEED_MODES = [
  { id: "subscribed", label: "Subscribed" },
  { id: "all", label: "All" },
  { id: "local", label: "Local" },
] as const;

const FEED_MIXES = [
  { id: "balanced", label: "Balanced" },
  { id: "reddit", label: "More Reddit" },
  { id: "lemmy", label: "More Lemmy" },
] as const;

const LAYOUTS = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Cards" },
] as const;

const APPEARANCES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

const LINK_HANDLING = [
  { id: "in-app", label: "In-app browser" },
  { id: "browser", label: "Default browser" },
] as const;

const BROWSERS = [
  { id: "default", label: "System" },
  { id: "chrome", label: "Chrome" },
  { id: "firefox", label: "Firefox" },
] as const;

// "" = the default Janus accent; the rest are tasteful presets, plus a custom
// hex via the palette swatch.
const ACCENT_PRESETS = [
  "",
  "#8b7cff",
  "#ff4500",
  "#00bc8c",
  "#ff6a3d",
  "#3d6aff",
  "#e84393",
  "#f9ca24",
] as const;

const SWIPE_ACTIONS: readonly { id: SwipeActionId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "upvote", label: "Upvote" },
  { id: "downvote", label: "Downvote" },
  { id: "save", label: "Save" },
];

const SWIPE_SLOTS: readonly { key: keyof SwipeConfig; label: string }[] = [
  { key: "rightShort", label: "Short right swipe" },
  { key: "rightLong", label: "Long right swipe" },
  { key: "leftShort", label: "Short left swipe" },
  { key: "leftLong", label: "Long left swipe" },
];

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

/**
 * Settings — the management surface for the unified, multi-account app:
 *  - Accounts: every signed-in identity (Reddit + each Lemmy instance), add/remove.
 *  - Instances: the Lemmy instances available to browse, signed-in or guest.
 *  - Groups: cross-source "multireddits" (r/x + name@instance + …), CRUD.
 *
 * Text entry uses the native Alert.prompt (iOS) to stay light; all the parsing
 * and persistence it drives is covered by unit tests in app/.
 */
export function SettingsScreen({ navigation }: Props) {
  const t = useTheme();
  const { settings, set } = useSettings();
  const {
    manager,
    accounts,
    lemmyAdapters,
    adapters,
    requestLogin,
    bumpAccountVersion,
    groups,
    reloadGroups,
  } = useAdapters();

  const refresh = () => bumpAccountVersion();

  const setSwipeSlot = (key: keyof SwipeConfig, action: SwipeActionId) =>
    set({ swipe: { ...settings.swipe, [key]: action } });

  // Turning archive recovery ON sends your browsing to a third party, so it
  // gets an explicit confirmation; turning it OFF is immediate.
  const confirmArchiveRecovery = (next: boolean) => {
    if (!next) {
      set({ archiveRecovery: false });
      return;
    }
    Alert.alert(
      "Turn on archive recovery?",
      "When this is on, the profiles and threads you open are sent to third-party archive services (Arctic Shift, PullPush) to look up content Reddit no longer serves, such as hidden histories and removed comments. Those services can see what you view. Recovered content is always labelled as archived.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn on", onPress: () => set({ archiveRecovery: true }) },
      ],
    );
  };

  const addKeyword = () => {
    Alert.prompt?.("Filter keyword", "Hide posts containing…", (raw) => {
      const word = (raw ?? "").trim();
      if (!word) return;
      const existing = settings.filters.keywords;
      if (existing.some((k) => k.toLowerCase() === word.toLowerCase())) return;
      set({ filters: { ...settings.filters, keywords: [...existing, word] } });
    });
  };

  const removeKeyword = (word: string) =>
    set({
      filters: {
        ...settings.filters,
        keywords: settings.filters.keywords.filter((k) => k !== word),
      },
    });

  const unmute = (kind: "mutedCommunities" | "mutedUsers", id: JanusId) =>
    set({
      filters: {
        ...settings.filters,
        [kind]: settings.filters[kind].filter((x) => x !== id),
      },
    });

  const clearCache = () => {
    Alert.alert("Clear image cache", "Remove all cached images?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          void Image.clearMemoryCache();
          void Image.clearDiskCache();
        },
      },
    ]);
  };

  const decodeHandle = (id: JanusId): string => {
    try {
      const p = parseId(id);
      return p.instance ? `${p.nativeId}@${p.instance}` : p.nativeId;
    } catch {
      return id;
    }
  };

  const logout = (account: (typeof accounts)[number]) => {
    Alert.alert("Log out", `Sign out of ${account.username}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await manager.logout(account);
          if (account.source === "reddit")
            await RedditCookies.clearSessionCookies();
          refresh();
        },
      },
    ]);
  };

  const addAccount = (source: "reddit" | "lemmy") => {
    // The login modal lives over the feed; trigger it then pop back to it.
    requestLogin(source);
    navigation.goBack();
  };

  const addInstance = () => {
    Alert.prompt?.("Add a Lemmy instance", "e.g. hexbear.net", async (raw) => {
      const instance = normalizeInstance(raw ?? "");
      if (!instance) return;
      await manager.addBrowseInstance(instance);
      refresh();
    });
  };

  const newGroup = () => {
    Alert.prompt?.("New group", "Name (e.g. Privacy)", async (name) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return;
      await saveGroup({ id: `g${Date.now()}`, name: trimmed, members: [] });
      await reloadGroups();
    });
  };

  const deleteGroup = (group: FeedGroup) => {
    Alert.alert("Delete group", `Delete "${group.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await removeGroup(group.id);
          await reloadGroups();
        },
      },
    ]);
  };

  const addMember = (group: FeedGroup) => {
    Alert.prompt?.(
      `Add to ${group.name}`,
      "r/privacy · privacy@lemmy.ml · https://hexbear.net/c/technology",
      async (raw) => {
        const addr = parseCommunityAddress(raw ?? "", manager.defaultLemmy);
        if (!addr) {
          Alert.alert(
            "Unrecognized",
            "Use r/name, name@instance, or a full community URL.",
          );
          return;
        }
        await saveGroup({ ...group, members: [...group.members, addr] });
        await reloadGroups();
      },
    );
  };

  const removeMember = async (group: FeedGroup, idx: number) => {
    const members = group.members.filter((_, i) => i !== idx);
    await saveGroup({ ...group, members });
    await reloadGroups();
  };

  const sectionHeader = (label: string, action?: React.ReactNode) => (
    <View style={styles.sectionRow}>
      <Text
        style={[
          t.type.small,
          styles.sectionLabel,
          { color: t.colors.textTertiary },
        ]}
      >
        {label}
      </Text>
      {action}
    </View>
  );

  const addButton = (label: string, onPress: () => void, a11y: string) => (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={styles.addBtn}
    >
      <Ionicons name="add" size={16} color={t.colors.accent} />
      <Text
        style={[t.type.small, { color: t.colors.accent, fontWeight: "700" }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  const rowStyle = {
    borderBottomColor: t.colors.border,
    backgroundColor: t.colors.card,
  };

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
          >
            <Ionicons name="chevron-back" size={26} color={t.colors.text} />
          </Pressable>
          <Text style={[t.type.title, { color: t.colors.text }]}>Settings</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {/* Accounts */}
          {sectionHeader("ACCOUNTS")}
          {accounts.length === 0 ? (
            <Text
              style={[
                t.type.meta,
                styles.empty,
                { color: t.colors.textTertiary },
              ]}
            >
              Not signed in anywhere yet. Browse as guest, or add an account.
            </Text>
          ) : (
            accounts.map((a) => (
              <View key={a.id} style={[styles.row, rowStyle]}>
                <Ionicons
                  name={a.source === "reddit" ? "logo-reddit" : "planet"}
                  size={20}
                  color={
                    a.source === "reddit" ? t.colors.reddit : t.colors.lemmy
                  }
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text
                    style={[
                      t.type.body,
                      { color: t.colors.text, fontWeight: "600" },
                    ]}
                  >
                    {a.username}
                  </Text>
                  <Text
                    style={[t.type.small, { color: t.colors.textTertiary }]}
                  >
                    {a.instance}
                  </Text>
                </View>
                <Pressable
                  onPress={() => logout(a)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Log out of ${a.username}`}
                >
                  <Text
                    style={[
                      t.type.small,
                      { color: t.colors.danger, fontWeight: "700" },
                    ]}
                  >
                    Log out
                  </Text>
                </Pressable>
              </View>
            ))
          )}
          <View style={styles.addRow}>
            {adapters.reddit.account.isGuest
              ? addButton(
                  "Reddit",
                  () => addAccount("reddit"),
                  "Add a Reddit account",
                )
              : null}
            {addButton(
              "Lemmy",
              () => addAccount("lemmy"),
              "Add a Lemmy account",
            )}
          </View>

          {/* Instances */}
          {sectionHeader(
            "LEMMY INSTANCES",
            addButton("Add", addInstance, "Add a Lemmy instance to browse"),
          )}
          {lemmyAdapters.map((a) => (
            <View key={a.instance} style={[styles.row, rowStyle]}>
              <Ionicons
                name="server-outline"
                size={18}
                color={t.colors.lemmy}
              />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, flex: 1, marginLeft: 12 },
                ]}
              >
                {a.instance}
              </Text>
              <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                {a.account.isGuest ? "Guest" : a.account.username}
              </Text>
            </View>
          ))}

          {/* Groups */}
          {sectionHeader(
            "GROUPS",
            addButton("New", newGroup, "Create a new feed group"),
          )}
          {groups.length === 0 ? (
            <Text
              style={[
                t.type.meta,
                styles.empty,
                { color: t.colors.textTertiary },
              ]}
            >
              Groups combine communities across Reddit and Lemmy instances into
              one feed — like a multireddit that spans the Fediverse.
            </Text>
          ) : (
            groups.map((g) => (
              <View
                key={g.id}
                style={[styles.groupBlock, { borderColor: t.colors.border }]}
              >
                <View style={styles.groupHead}>
                  <Text
                    style={[
                      t.type.body,
                      { color: t.colors.text, fontWeight: "700", flex: 1 },
                    ]}
                  >
                    {g.name}
                  </Text>
                  <Pressable
                    onPress={() => addMember(g)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a community to ${g.name}`}
                    style={{ marginRight: 16 }}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={20}
                      color={t.colors.accent}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => deleteGroup(g)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${g.name}`}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={t.colors.danger}
                    />
                  </Pressable>
                </View>
                {g.members.length === 0 ? (
                  <Text
                    style={[
                      t.type.small,
                      { color: t.colors.textTertiary, paddingVertical: 6 },
                    ]}
                  >
                    No communities yet — tap + to add one.
                  </Text>
                ) : (
                  g.members.map((m: CommunityAddress, i) => (
                    <View
                      key={`${addressLabel(m)}-${i}`}
                      style={styles.memberRow}
                    >
                      <Ionicons
                        name={m.source === "reddit" ? "logo-reddit" : "planet"}
                        size={14}
                        color={
                          m.source === "reddit"
                            ? t.colors.reddit
                            : t.colors.lemmy
                        }
                      />
                      <Text
                        style={[
                          t.type.small,
                          {
                            color: t.colors.textSecondary,
                            flex: 1,
                            marginLeft: 8,
                          },
                        ]}
                      >
                        {addressLabel(m)}
                      </Text>
                      <Pressable
                        onPress={() => removeMember(g, i)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${addressLabel(m)} from ${g.name}`}
                      >
                        <Ionicons
                          name="close"
                          size={16}
                          color={t.colors.textTertiary}
                        />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            ))
          )}

          {/* Appearance */}
          {sectionHeader("APPEARANCE")}
          <ChoiceRow
            label="Theme"
            value={settings.appearance}
            options={APPEARANCES}
            onChange={(v) => set({ appearance: v })}
          />
          <View style={styles.accentBlock}>
            <Text
              style={[t.type.meta, { color: t.colors.text, marginBottom: 10 }]}
            >
              Accent color
            </Text>
            <View style={styles.accentRow}>
              {ACCENT_PRESETS.map((c) => {
                const selected = settings.themeAccent === c;
                return (
                  <Pressable
                    key={c || "default"}
                    onPress={() => set({ themeAccent: c })}
                    accessibilityRole="button"
                    accessibilityLabel={c ? `Accent ${c}` : "Default accent"}
                    accessibilityState={{ selected }}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: c || t.colors.bgElevated,
                        borderColor: selected ? t.colors.text : t.colors.border,
                        borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    {!c ? (
                      <Ionicons
                        name="contrast-outline"
                        size={15}
                        color={t.colors.textSecondary}
                      />
                    ) : selected ? (
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    ) : null}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() =>
                  Alert.prompt?.(
                    "Custom accent",
                    "Hex color, e.g. #ff6600",
                    (raw) => {
                      const hex = clampHex(raw ?? "");
                      if (hex) set({ themeAccent: hex });
                    },
                    "plain-text",
                    settings.themeAccent,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Custom accent color"
                style={[
                  styles.swatch,
                  styles.swatchCustom,
                  { borderColor: t.colors.border },
                ]}
              >
                <Ionicons
                  name="color-palette-outline"
                  size={16}
                  color={t.colors.accent}
                />
              </Pressable>
            </View>
          </View>
          <ToggleRow
            label="True black (OLED)"
            hint="Pure-black backgrounds in dark mode."
            value={settings.oledBlack}
            onChange={(v) => set({ oledBlack: v })}
          />
          <ToggleRow
            label="Split view on iPad"
            hint="Show the feed and the open post side by side on wide screens."
            value={settings.splitView}
            onChange={(v) => set({ splitView: v })}
          />
          <ChoiceRow
            label="Post layout"
            hint="Compact list rows or full cards."
            value={settings.postLayout}
            options={LAYOUTS}
            onChange={(v) => set({ postLayout: v })}
          />
          <StepperRow
            label="Text size"
            value={settings.fontScale}
            display={`${Math.round(settings.fontScale * 100)}%`}
            min={0.85}
            max={1.4}
            step={0.05}
            onChange={(v) => set({ fontScale: v })}
          />
          <ToggleRow
            label="Blur NSFW"
            hint="Blur thumbnails on adult posts until tapped."
            value={settings.blurNsfw}
            onChange={(v) => set({ blurNsfw: v })}
          />
          {settings.blurNsfw ? (
            <ToggleRow
              label="Reveal NSFW in gallery"
              hint="In full-screen gallery mode, show NSFW media without tapping each one. There's also an eye toggle in the gallery itself."
              value={settings.revealNsfwInReel}
              onChange={(v) => set({ revealNsfwInReel: v })}
            />
          ) : null}
          <ToggleRow
            label="Blur spoilers"
            hint="Blur spoiler-marked posts until tapped."
            value={settings.blurSpoilers}
            onChange={(v) => set({ blurSpoilers: v })}
          />
          <ToggleRow
            label="Autoplay videos"
            hint="Play feed videos automatically (muted)."
            value={settings.autoplayVideo}
            onChange={(v) => set({ autoplayVideo: v })}
          />
          <StepperRow
            label="Title lines"
            hint="Max lines a post title shows before truncating."
            value={settings.titleMaxLines}
            display={`${settings.titleMaxLines}`}
            min={1}
            max={6}
            step={1}
            onChange={(v) => set({ titleMaxLines: v })}
          />
          {canChangeAppIcon && APP_ICON_CHOICES.length > 1 ? (
            <ChoiceRow
              label="App icon"
              value={currentAppIcon() ?? "default"}
              options={APP_ICON_CHOICES.map((c) => ({
                id: c.id ?? "default",
                label: c.label,
              }))}
              onChange={(v) => void applyAppIcon(v === "default" ? null : v)}
            />
          ) : null}

          {/* Feed */}
          {sectionHeader("FEED")}
          <ChoiceRow
            label="Default feed"
            value={settings.defaultFeed}
            options={FEED_MODES}
            onChange={(v) => set({ defaultFeed: v })}
          />
          <ChoiceRow
            label="Feed blend"
            hint="How the All feed mixes Reddit and Lemmy."
            value={settings.feedMix}
            options={FEED_MIXES}
            onChange={(v) => set({ feedMix: v })}
          />
          <ChoiceRow
            label="Default post sort"
            value={settings.defaultPostSort}
            options={POST_SORTS}
            onChange={(v) => set({ defaultPostSort: v })}
          />
          <ChoiceRow
            label="Top posts from"
            hint="Time window used when sorting by Top."
            value={settings.topTimeWindow}
            options={TIME_WINDOWS}
            onChange={(v) => set({ topTimeWindow: v })}
          />
          <ChoiceRow
            label="Default comment sort"
            value={settings.defaultCommentSort}
            options={COMMENT_SORTS}
            onChange={(v) => set({ defaultCommentSort: v })}
          />
          <ToggleRow
            label="Hide NSFW posts"
            hint="Remove adult posts from feeds entirely."
            value={settings.hideNsfw}
            onChange={(v) => set({ hideNsfw: v })}
          />
          <ToggleRow
            label="Keep NSFW out of History"
            hint="Don't record NSFW threads in History or new-comment tracking."
            value={settings.excludeNsfwFromHistory}
            onChange={(v) => set({ excludeNsfwFromHistory: v })}
          />
          <ToggleRow
            label="Hide seen posts"
            hint="Remove posts you've already opened on the next refresh."
            value={settings.hideSeenPosts}
            onChange={(v) => set({ hideSeenPosts: v })}
          />
          <ToggleRow
            label="Collapse cross-posts"
            hint="Fold the same link/image posted across communities and networks into one card."
            value={settings.collapseCrossNetwork}
            onChange={(v) => set({ collapseCrossNetwork: v })}
          />
          <ToggleRow
            label="Remember sort per community"
            hint="Reopen each community with the sort you last used."
            value={settings.rememberCommunitySort}
            onChange={(v) => set({ rememberCommunitySort: v })}
          />
          <ToggleRow
            label="Collapse AutoModerator"
            hint="Start AutoModerator / bot comments collapsed."
            value={settings.collapseAutoModerator}
            onChange={(v) => set({ collapseAutoModerator: v })}
          />
          <ToggleRow
            label="Color-code commenters"
            hint="Give each commenter a stable color in threads so the same person is easy to follow. OP stays the accent color."
            value={settings.colorizeUsernames}
            onChange={(v) => set({ colorizeUsernames: v })}
          />
          <ToggleRow
            label="Archive recovery"
            hint="Reddit only. Adds a tap option to reconstruct a hidden profile's history or recover a [removed]/[deleted] comment from public archives (Arctic Shift, PullPush). Each lookup sends what you ask for to those third-party services, so they can see it. Nothing is fetched until you tap; turning this on here just skips the one-time prompt."
            value={settings.archiveRecovery}
            onChange={confirmArchiveRecovery}
          />

          {/* Gestures */}
          {sectionHeader("SWIPE ACTIONS")}
          {SWIPE_SLOTS.map((slot) => (
            <ChoiceRow
              key={slot.key}
              label={slot.label}
              value={settings.swipe[slot.key]}
              options={SWIPE_ACTIONS}
              onChange={(v) => setSwipeSlot(slot.key, v)}
            />
          ))}
          <ToggleRow
            label="Haptic feedback"
            hint="Vibrate as a swipe action arms."
            value={settings.haptics}
            onChange={(v) => set({ haptics: v })}
          />

          {/* General */}
          {sectionHeader("GENERAL")}
          <ChoiceRow
            label="Open links in"
            value={settings.linkHandling}
            options={LINK_HANDLING}
            onChange={(v) => set({ linkHandling: v })}
          />
          {settings.linkHandling === "in-app" ? (
            <ToggleRow
              label="Reader mode"
              hint="Open articles in a clutter-free reader when possible."
              value={settings.readerMode}
              onChange={(v) => set({ readerMode: v })}
            />
          ) : (
            <ChoiceRow
              label="Browser"
              hint="Which app external links open in."
              value={settings.externalBrowser}
              options={BROWSERS}
              onChange={(v) => set({ externalBrowser: v })}
            />
          )}

          {/* Filters & blocks */}
          {sectionHeader(
            "FILTERS & BLOCKS",
            addButton("Keyword", addKeyword, "Add a keyword filter"),
          )}
          {settings.filters.keywords.length === 0 ? (
            <Text
              style={[
                t.type.meta,
                styles.empty,
                { color: t.colors.textTertiary },
              ]}
            >
              Hide posts containing words you&apos;d rather not see — applied
              across Reddit and every Lemmy instance alike.
            </Text>
          ) : (
            <View style={styles.keywordWrap}>
              {settings.filters.keywords.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => removeKeyword(k)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove keyword ${k}`}
                  style={[
                    styles.keywordChip,
                    {
                      borderColor: t.colors.border,
                      backgroundColor: t.colors.bgElevated,
                      borderRadius: t.radius.pill,
                    },
                  ]}
                >
                  <Text style={[t.type.small, { color: t.colors.text }]}>
                    {k}
                  </Text>
                  <Ionicons
                    name="close"
                    size={14}
                    color={t.colors.textTertiary}
                    style={{ marginLeft: 6 }}
                  />
                </Pressable>
              ))}
            </View>
          )}
          {settings.filters.mutedCommunities.map((id) => (
            <View
              key={id}
              style={[styles.row, rowStyle]}
              accessibilityLabel={`Muted community ${decodeHandle(id)}`}
            >
              <Ionicons name="planet" size={16} color={t.colors.lemmy} />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, flex: 1, marginLeft: 12 },
                ]}
              >
                {decodeHandle(id)}
              </Text>
              <Pressable
                onPress={() => unmute("mutedCommunities", id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Unmute ${decodeHandle(id)}`}
              >
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.accent, fontWeight: "700" },
                  ]}
                >
                  Unmute
                </Text>
              </Pressable>
            </View>
          ))}
          {settings.filters.mutedUsers.map((id) => (
            <View
              key={id}
              style={[styles.row, rowStyle]}
              accessibilityLabel={`Muted user ${decodeHandle(id)}`}
            >
              <Ionicons
                name="person-circle-outline"
                size={16}
                color={t.colors.textSecondary}
              />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.text, flex: 1, marginLeft: 12 },
                ]}
              >
                {decodeHandle(id)}
              </Text>
              <Pressable
                onPress={() => unmute("mutedUsers", id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Unmute ${decodeHandle(id)}`}
              >
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.accent, fontWeight: "700" },
                  ]}
                >
                  Unmute
                </Text>
              </Pressable>
            </View>
          ))}

          {/* Advanced */}
          {sectionHeader("ADVANCED")}
          <Pressable
            onPress={() => navigation.navigate("AiLens")}
            accessibilityRole="button"
            accessibilityLabel="AI Lens — on-device AI writing detection"
            style={[styles.row, rowStyle]}
          >
            <Ionicons name="scan-outline" size={18} color={t.colors.accent} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, flex: 1, marginLeft: 12 },
              ]}
            >
              AI Lens
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={t.colors.textTertiary}
            />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("History")}
            accessibilityRole="button"
            accessibilityLabel="Browsing history"
            style={[styles.row, rowStyle]}
          >
            <Ionicons name="time-outline" size={18} color={t.colors.accent} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, flex: 1, marginLeft: 12 },
              ]}
            >
              History
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={t.colors.textTertiary}
            />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Stats")}
            accessibilityRole="button"
            accessibilityLabel="Your activity"
            style={[styles.row, rowStyle]}
          >
            <Ionicons
              name="stats-chart-outline"
              size={18}
              color={t.colors.accent}
            />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, flex: 1, marginLeft: 12 },
              ]}
            >
              Your activity
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={t.colors.textTertiary}
            />
          </Pressable>
          <Pressable
            onPress={clearCache}
            accessibilityRole="button"
            accessibilityLabel="Clear image cache"
            style={[styles.row, rowStyle]}
          >
            <Ionicons name="trash-outline" size={18} color={t.colors.danger} />
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, flex: 1, marginLeft: 12 },
              ]}
            >
              Clear image cache
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={t.colors.textTertiary}
            />
          </Pressable>
        </ScrollView>
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 6,
  },
  sectionLabel: { fontWeight: "700", letterSpacing: 0.5 },
  accentBlock: { paddingHorizontal: 16, paddingVertical: 14 },
  accentRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchCustom: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addRow: {
    flexDirection: "row",
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  empty: { paddingHorizontal: 16, paddingVertical: 8, lineHeight: 18 },
  groupBlock: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  groupHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  keywordWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  keywordChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
