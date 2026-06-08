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
import { useTheme } from "../theme";
import RedditCookies from "../../../utils/RedditCookies";
import { normalizeInstance } from "../../sources/lemmy/LemmyInstance";
import { parseId } from "../../core/ids";
import type { JanusId } from "../../core/ids";
import type { SwipeActionId, SwipeConfig } from "../../app/settingsStore";
import { ToggleRow, ChoiceRow, StepperRow } from "../components/SettingRows";
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
          ) : null}

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
