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
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useTheme } from "../theme";
import RedditCookies from "../../../utils/RedditCookies";
import { normalizeInstance } from "../../sources/lemmy/LemmyInstance";
import {
  parseCommunityAddress,
  addressLabel,
  saveGroup,
  removeGroup,
  type FeedGroup,
  type CommunityAddress,
} from "../../app/feedGroups";

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
});
