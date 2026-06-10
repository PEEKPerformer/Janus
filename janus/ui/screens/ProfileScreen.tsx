import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAsync, useFeed } from "../hooks";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { Markdown } from "../components/Markdown";
import { CommentComposer } from "../components/CommentComposer";
import { popularEmojiFor } from "../emojiPopular";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { compactNumber, relativeTime } from "../format";
import { isHttpUrl } from "../links";
import type { Post, Comment, User } from "../../core/model";
import type { UserContentKind } from "../../core/adapter";
import { ActionSheet, type ActionItem } from "../components/ActionSheet";
import {
  initSavedCategories,
  getCategory,
  setCategory,
  listCategories,
} from "../../app/savedCategories";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

const BASE_TABS: { id: UserContentKind; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "posts", label: "Posts" },
  { id: "comments", label: "Comments" },
];
const SAVED_TAB = { id: "saved" as UserContentKind, label: "Saved" };

function isPost(item: Post | Comment): item is Post {
  return "title" in item;
}

export function ProfileScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { userId, source, handle } = route.params;
  const { adapters } = useAdapters();
  const adapter = adapters[source];

  const [tab, setTab] = useState<UserContentKind>("overview");

  // Saved categories — a local, cross-network overlay on the saved tab
  // (RES-style folders over Reddit's and Lemmy's flat saved lists).
  const [catVersion, setCatVersion] = useState(0);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [catTarget, setCatTarget] = useState<string | null>(null);
  useEffect(() => {
    void initSavedCategories().then(() => setCatVersion((v) => v + 1));
  }, []);
  useEffect(() => setActiveCat(null), [tab]);
  const categories = useMemo(() => {
    void catVersion;
    return listCategories();
  }, [catVersion]);
  const assignCategory = (id: string, category: string | null) => {
    setCategory(id, category);
    setCatVersion((v) => v + 1);
    setCatTarget(null);
  };
  const categorySheetItems = (id: string): ActionItem[] => {
    const current = getCategory(id);
    const items: ActionItem[] = categories.map((c) => ({
      label: c === current ? `${c} ✓` : c,
      icon: "folder-outline" as const,
      onPress: () => assignCategory(id, c),
    }));
    items.push({
      label: "New category…",
      icon: "add-circle-outline",
      onPress: () => {
        setCatTarget(null);
        Alert.prompt?.("New category", "e.g. Churning datapoints", (name) => {
          const trimmed = (name ?? "").trim();
          if (trimmed) assignCategory(id, trimmed);
        });
      },
    });
    if (current) {
      items.push({
        label: "Remove from category",
        icon: "close-circle-outline",
        destructive: true,
        onPress: () => assignCategory(id, null),
      });
    }
    return items;
  };

  const user = useAsync<User>(() => adapter.getUser(userId), [userId]);
  const customEmojis = useAsync(
    () =>
      adapter.getCustomEmojis ? adapter.getCustomEmojis() : Promise.resolve([]),
    [source],
  );
  const content = useFeed<Post | Comment>(
    (page) => adapter.getUserContent(userId, tab, page),
    [userId, tab],
  );

  const sourceColor = source === "reddit" ? t.colors.reddit : t.colors.lemmy;

  // Can message/block only when signed in and not viewing your own profile.
  const canInteract = !adapter.account.isGuest && adapter.account.id !== userId;
  // Your own saved items are private — only show the Saved tab on your profile.
  const isOwnProfile =
    !adapter.account.isGuest && adapter.account.id === userId;
  const TABS = isOwnProfile ? [...BASE_TABS, SAVED_TAB] : BASE_TABS;
  const [dmOpen, setDmOpen] = useState(false);
  const [dmSubject, setDmSubject] = useState("");
  const [sendingDm, setSendingDm] = useState(false);
  const [notice, setNotice] = useState<string>();

  // Reddit DMs carry a subject; capture it before the body composer opens.
  const openDm = () => {
    if (source === "reddit" && Alert.prompt) {
      Alert.prompt(
        "New message",
        "Subject (optional)",
        (s?: string) => {
          setDmSubject(s ?? "");
          setDmOpen(true);
        },
        "plain-text",
      );
    } else {
      setDmSubject("");
      setDmOpen(true);
    }
  };

  const sendDm = async (markdown: string) => {
    if (sendingDm) return;
    setSendingDm(true);
    try {
      await adapter.sendMessage({
        to: userId,
        markdown,
        subject: dmSubject || undefined,
      });
      setDmOpen(false);
      setNotice("Message sent");
    } catch {
      setNotice("Couldn't send — try again");
    } finally {
      setSendingDm(false);
    }
  };

  const blockUser = () => {
    Alert.alert("Block user", `Block ${handle}? You won't see their content.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await adapter.blockUser(userId, true);
            setNotice(`Blocked ${handle}`);
          } catch {
            setNotice("Couldn't block — try again");
          }
        },
      },
    ]);
  };

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(undefined), 2400);
    return () => clearTimeout(id);
  }, [notice]);

  const openPost = (post: Post) => navigation.navigate("Post", { post });

  const header = (
    <View>
      <View style={{ padding: t.spacing.lg, alignItems: "center" }}>
        {user.data && isHttpUrl(user.data.avatar) ? (
          <Image
            source={{ uri: user.data.avatar }}
            style={[styles.avatar, { borderColor: sourceColor }]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarFallback,
              {
                backgroundColor: t.colors.bgElevated,
                borderColor: sourceColor,
              },
            ]}
          >
            <Ionicons name="person" size={28} color={sourceColor} />
          </View>
        )}
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, fontSize: 18, marginTop: 10 },
          ]}
          numberOfLines={1}
        >
          {handle}
        </Text>
        {user.data ? (
          <View style={styles.karmaRow}>
            {user.data.postScore !== undefined ? (
              <Text style={[t.type.meta, { color: t.colors.textSecondary }]}>
                {compactNumber(user.data.postScore)}{" "}
                {source === "reddit" ? "post karma" : "posts"}
              </Text>
            ) : null}
            {user.data.commentScore !== undefined ? (
              <Text
                style={[
                  t.type.meta,
                  { color: t.colors.textSecondary, marginLeft: 14 },
                ]}
              >
                {compactNumber(user.data.commentScore)}{" "}
                {source === "reddit" ? "comment karma" : "comments"}
              </Text>
            ) : null}
          </View>
        ) : null}
        {user.data?.createdAt ? (
          <Text
            style={[
              t.type.small,
              { color: t.colors.textTertiary, marginTop: 4 },
            ]}
          >
            Joined {relativeTime(user.data.createdAt)}
          </Text>
        ) : null}
        {user.data?.bio?.text ? (
          <View
            style={{ marginTop: 10, alignSelf: "stretch" }}
            pointerEvents="none"
          >
            <Markdown
              source={user.data.bio.text}
              numberOfLines={3}
              color={t.colors.textSecondary}
            />
          </View>
        ) : null}

        {canInteract ? (
          <View style={styles.actions}>
            <Pressable
              onPress={openDm}
              accessibilityRole="button"
              accessibilityLabel={`Message ${handle}`}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: t.colors.accentActive,
                  borderRadius: t.radius.pill,
                },
              ]}
            >
              <Ionicons name="mail-outline" size={15} color="#fff" />
              <Text
                style={[
                  t.type.meta,
                  { color: "#fff", marginLeft: 6, fontWeight: "600" },
                ]}
              >
                Message
              </Text>
            </Pressable>
            <Pressable
              onPress={blockUser}
              accessibilityRole="button"
              accessibilityLabel={`Block ${handle}`}
              style={[
                styles.actionBtn,
                {
                  borderColor: t.colors.border,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderRadius: t.radius.pill,
                  marginLeft: 10,
                },
              ]}
            >
              <Ionicons name="ban-outline" size={15} color={t.colors.danger} />
              <Text
                style={[
                  t.type.meta,
                  { color: t.colors.danger, marginLeft: 6, fontWeight: "600" },
                ]}
              >
                Block
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.tabs,
          {
            borderBottomColor: t.colors.border,
            borderTopColor: t.colors.border,
          },
        ]}
      >
        {TABS.map((tabDef) => {
          const active = tabDef.id === tab;
          return (
            <Pressable
              key={tabDef.id}
              onPress={() => setTab(tabDef.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tabDef.label}
              style={[
                styles.tab,
                active && { borderBottomColor: t.colors.accent },
              ]}
            >
              <Text
                style={[
                  t.type.meta,
                  {
                    color: active ? t.colors.text : t.colors.textTertiary,
                    fontWeight: active ? "700" : "500",
                  },
                ]}
              >
                {tabDef.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderComment = (comment: Comment) => (
    <View
      style={[
        styles.commentCard,
        {
          backgroundColor: t.colors.card,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
        },
      ]}
    >
      <View style={styles.commentMeta}>
        <Ionicons
          name="chatbubble-outline"
          size={13}
          color={t.colors.textTertiary}
        />
        <Text
          style={[
            t.type.small,
            { color: t.colors.textTertiary, marginLeft: 6, flex: 1 },
          ]}
          numberOfLines={1}
        >
          {compactNumber(comment.score)} points ·{" "}
          {relativeTime(comment.createdAt)}
        </Text>
      </View>
      {comment.body.text ? (
        <View style={{ marginTop: 4 }} pointerEvents="none">
          <Markdown
            source={comment.body.text}
            numberOfLines={4}
            color={t.colors.text}
          />
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (content.loading) {
    body = <SkeletonFeed />;
  } else if (content.error && content.items.length === 0) {
    body = (
      <ErrorView
        error={content.error}
        onRetry={content.refresh}
        sourceLabel={adapter.instance}
      />
    );
  } else {
    const savedTab = tab === "saved";
    const items =
      savedTab && activeCat
        ? content.items.filter((i) => getCategory(i.id) === activeCat)
        : content.items;
    const savedChips =
      savedTab && categories.length > 0 ? (
        <View style={styles.catChips}>
          {[null, ...categories].map((c) => {
            const active = activeCat === c;
            return (
              <Pressable
                key={c ?? "__all"}
                onPress={() => setActiveCat(c)}
                accessibilityRole="button"
                accessibilityLabel={c ? `Category ${c}` : "All saved"}
                accessibilityState={{ selected: active }}
                style={[
                  styles.catChip,
                  {
                    borderRadius: t.radius.pill,
                    borderColor: active ? t.colors.accentActive : t.colors.border,
                    backgroundColor: active
                      ? t.colors.accentActive
                      : t.colors.bgElevated,
                  },
                ]}
              >
                <Text
                  style={[
                    t.type.small,
                    { color: active ? "#fff" : t.colors.textSecondary },
                  ]}
                >
                  {c ?? "All"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null;
    body = (
      <FlashList
        data={items}
        keyExtractor={(item) => item.id}
        extraData={`${catVersion}-${activeCat}`}
        ListHeaderComponent={savedChips}
        renderItem={({ item }) =>
          isPost(item) ? (
            <PostCard
              post={item}
              onPress={() => openPost(item)}
              onLongPress={savedTab ? () => setCatTarget(item.id) : undefined}
              compact
              showSource={false}
            />
          ) : savedTab ? (
            <Pressable
              onLongPress={() => setCatTarget(item.id)}
              accessibilityRole="button"
              accessibilityLabel="Saved comment. Long-press to categorize."
            >
              {renderComment(item)}
            </Pressable>
          ) : (
            renderComment(item)
          )
        }
        ListEmptyComponent={
          <EmptyView
            title="Nothing here yet"
            detail={
              savedTab && activeCat
                ? `Nothing filed under "${activeCat}" on this page.`
                : `No ${tab} to show.`
            }
          />
        }
        onEndReached={content.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={content.refreshing}
        onRefresh={content.refresh}
        ListFooterComponent={
          content.loadingMore ? (
            <ActivityIndicator
              color={t.colors.accent}
              style={{ marginVertical: 20 }}
            />
          ) : (
            <View style={{ height: 20 }} />
          )
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {header}
      <View style={styles.fill}>{body}</View>
      {notice ? (
        <View
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 24,
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.pill,
            },
          ]}
          accessibilityRole="alert"
        >
          <Text style={[t.type.meta, { color: t.colors.text }]}>{notice}</Text>
        </View>
      ) : null}
      {dmOpen ? (
        <CommentComposer
          contextLabel={`Message ${handle}`}
          submitting={sendingDm}
          submitLabel="Send"
          source={source}
          customEmojis={customEmojis.data ?? undefined}
          popularEmoji={popularEmojiFor(adapter.instance)}
          emojiInstance={adapter.instance}
          onSubmit={sendDm}
          onCancel={() => setDmOpen(false)}
        />
      ) : null}
      <ActionSheet
        visible={catTarget !== null}
        title="File under category"
        items={catTarget ? categorySheetItems(catTarget) : []}
        onClose={() => setCatTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  catChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  karmaRow: { flexDirection: "row", marginTop: 8 },
  actions: { flexDirection: "row", marginTop: 14 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  commentCard: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 12,
    borderWidth: 1,
  },
  commentMeta: { flexDirection: "row", alignItems: "center" },
});
