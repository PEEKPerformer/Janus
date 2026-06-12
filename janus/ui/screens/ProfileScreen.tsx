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
import { resolveCommunityRef } from "../communityNav";
import { useAsync, useFeed } from "../hooks";
import { useSettings } from "../SettingsContext";
import { ensureArchiveConsent } from "../archiveConsent";
import { useTheme } from "../theme";
import { PostCard } from "../components/PostCard";
import { Markdown } from "../components/Markdown";
import { CommentComposer } from "../components/CommentComposer";
import { popularEmojiFor } from "../emojiPopular";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { compactNumber, relativeTime } from "../format";
import { isHttpUrl } from "../links";
import type { Post, Comment, User } from "../../core/model";
import { JanusError } from "../../core/errors";
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

/** Header on a reconstructed-history list: this is the public archive, not live. */
function ArchiveBanner({
  handle,
  whatTab,
}: {
  handle: string;
  whatTab: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{
        flexDirection: "row",
        gap: 8,
        marginHorizontal: 12,
        marginBottom: 8,
        padding: 10,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.bgElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.colors.border,
      }}
    >
      <Ionicons
        name="archive-outline"
        size={16}
        color={t.colors.textSecondary}
        style={{ marginTop: 1 }}
      />
      <Text style={[t.type.small, { color: t.colors.textSecondary, flex: 1 }]}>
        {handle} hid their {whatTab}. Showing the public archive (Arctic Shift,
        PullPush). It may be incomplete or out of date, and reflects what was
        public when archived.
      </Text>
    </View>
  );
}

export function ProfileScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { userId, source, handle } = route.params;
  const { adapters, adapterForEntity } = useAdapters();
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

  // When a profile hides its history the listing 403s. Recovery from a public
  // archive is on-tap (Reddit-only): we never reach the archive until the user
  // taps "Show archived history", which discloses the third-party lookup once.
  const { settings, set } = useSettings();
  const forbidden =
    content.error instanceof JanusError && content.error.code === "FORBIDDEN";
  const canArchive = typeof adapter.recoverUserContent === "function";
  const [archiveRequested, setArchiveRequested] = useState(false);
  useEffect(() => setArchiveRequested(false), [tab, userId]);
  const archiveActive = forbidden && canArchive && archiveRequested;
  const archive = useFeed<Post | Comment>(
    (page) =>
      archiveActive && adapter.recoverUserContent
        ? adapter.recoverUserContent(userId, tab, page)
        : Promise.resolve({ items: [] }),
    [userId, tab, archiveActive],
  );
  const requestArchive = () =>
    ensureArchiveConsent(
      settings.archiveRecovery,
      () => set({ archiveRecovery: true }),
      () => setArchiveRequested(true),
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

  // Open the thread a profile comment belongs to, focused on that comment.
  // The comment carries its postId; fetch the post to seed the thread screen.
  const [openingThread, setOpeningThread] = useState(false);
  const openCommentThread = async (comment: Comment) => {
    if (openingThread) return;
    setOpeningThread(true);
    try {
      const post = await adapter.getPost(comment.postId);
      navigation.navigate("Post", { post, focusCommentId: comment.id });
    } catch {
      setNotice("Couldn't open that thread");
    } finally {
      setOpeningThread(false);
    }
  };

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

  const renderComment = (comment: Comment) => {
    const ctx = comment.context;
    return (
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
        {ctx ? (
          <>
            {/* Community header, matching the post card's avatar + handle. */}
            <View style={styles.commentContext}>
              {isHttpUrl(ctx.community.icon) ? (
                <Image
                  source={{ uri: ctx.community.icon }}
                  style={[styles.contextAvatar, { borderColor: sourceColor }]}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[styles.contextDot, { backgroundColor: sourceColor }]}
                />
              )}
              <Text
                style={[
                  t.type.meta,
                  {
                    color: t.colors.text,
                    fontWeight: "600",
                    flexShrink: 1,
                    marginLeft: isHttpUrl(ctx.community.icon) ? 8 : 7,
                  },
                ]}
                numberOfLines={1}
              >
                {ctx.community.handle}
              </Text>
              <View style={styles.headerTrail}>
                <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
                  · {relativeTime(comment.createdAt)}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={13}
                  color={t.colors.textTertiary}
                  style={{ marginLeft: 2 }}
                />
              </View>
            </View>
            {ctx.postTitle ? (
              <View style={styles.replyingRow}>
                <Ionicons
                  name="arrow-undo-outline"
                  size={12}
                  color={t.colors.textTertiary}
                />
                <Text
                  style={[
                    t.type.small,
                    { color: t.colors.textSecondary, marginLeft: 5, flex: 1 },
                  ]}
                  numberOfLines={1}
                >
                  {ctx.postTitle}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
        {comment.body.text ? (
          <View style={{ marginTop: ctx ? 6 : 0 }} pointerEvents="none">
            <Markdown
              source={comment.body.text}
              numberOfLines={4}
              color={t.colors.text}
            />
          </View>
        ) : null}
        {/* Footer: badges + score, matching the post card's stat row. */}
        <View style={styles.commentFooter}>
          {comment.isOP ? (
            <View
              style={[styles.opBadge, { backgroundColor: t.colors.bgElevated }]}
            >
              <Text style={[styles.opBadgeText, { color: t.colors.accent }]}>
                OP
              </Text>
            </View>
          ) : null}
          {comment.distinguished === "moderator" ? (
            <Ionicons
              name="shield-checkmark"
              size={12}
              color={t.colors.lemmy}
              style={{ marginRight: 4 }}
            />
          ) : null}
          <Ionicons name="arrow-up" size={13} color={t.colors.textTertiary} />
          <Text
            style={[
              t.type.meta,
              {
                color: t.colors.textSecondary,
                fontWeight: "600",
                marginLeft: 3,
              },
            ]}
          >
            {compactNumber(comment.score)}
          </Text>
          {!ctx ? (
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginLeft: 8 },
              ]}
            >
              {relativeTime(comment.createdAt)}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  // A profile/saved comment row: tapping opens its thread at that comment;
  // the saved tab adds long-press to file it under a category.
  const commentRow = (comment: Comment, onLongPress?: () => void) => (
    <Pressable
      onPress={() => openCommentThread(comment)}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Comment in ${
        comment.context?.community.handle ?? "a thread"
      }. Opens the thread.`}
    >
      {renderComment(comment)}
    </Pressable>
  );

  const whatTab = tab === "posts" || tab === "comments" ? tab : "post history";

  let body: React.ReactNode;
  if (content.loading) {
    body = <SkeletonFeed />;
  } else if (forbidden && content.items.length === 0) {
    // A 403 on a user listing means the user hides their history (Reddit's
    // profile-curation setting; Lemmy instance policy), a fact, not a fault.
    // Retrying live can never help; offer to recover it from a public archive
    // on tap (the tap is the consent; nothing is fetched before it).
    if (!canArchive) {
      body = (
        <EmptyView
          title="History is private"
          detail={`${handle} has chosen not to show their ${whatTab}.`}
        />
      );
    } else if (!archiveRequested) {
      body = (
        <View style={styles.privateState}>
          <EmptyView
            title="History is private"
            detail={`${handle} has chosen not to show their ${whatTab}. You can try to reconstruct it from public archives.`}
          />
          <Pressable
            onPress={requestArchive}
            accessibilityRole="button"
            accessibilityLabel="Show archived history"
            style={[
              styles.archiveCta,
              {
                borderRadius: t.radius.pill,
                backgroundColor: t.colors.accentActive,
              },
            ]}
          >
            <Ionicons name="archive-outline" size={16} color="#fff" />
            <Text style={[t.type.body, { color: "#fff", marginLeft: 8 }]}>
              Show archived history
            </Text>
          </Pressable>
        </View>
      );
    } else if (archive.loading) {
      body = <SkeletonFeed />;
    } else if (archive.items.length > 0) {
      body = (
        <FlashList
          data={archive.items}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <ArchiveBanner handle={handle} whatTab={whatTab} />
          }
          renderItem={({ item }) =>
            isPost(item) ? (
              <PostCard
                post={item}
                onPress={() => openPost(item)}
                compact
                showSource={false}
              />
            ) : (
              commentRow(item)
            )
          }
          onEndReached={archive.loadMore}
          onEndReachedThreshold={0.6}
          refreshing={archive.refreshing}
          onRefresh={archive.refresh}
          ListFooterComponent={
            archive.loadingMore ? (
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
    } else {
      body = (
        <EmptyView
          title="History is private"
          detail={`${handle} hid their ${whatTab}, and the public archives have nothing for it either.`}
        />
      );
    }
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
                    borderColor: active
                      ? t.colors.accentActive
                      : t.colors.border,
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
              onOpenCommunity={(c) => {
                void resolveCommunityRef(adapterForEntity, c).then(
                  (full) =>
                    full &&
                    navigation.navigate("Feed", { openCommunity: full }),
                );
              }}
              compact
              showSource={false}
            />
          ) : savedTab ? (
            commentRow(item, () => setCatTarget(item.id))
          ) : (
            commentRow(item)
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
  privateState: { flex: 1, alignItems: "center", justifyContent: "center" },
  archiveCta: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginTop: 4,
  },
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
  commentContext: { flexDirection: "row", alignItems: "center" },
  contextAvatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  contextDot: { width: 9, height: 9, borderRadius: 5 },
  headerTrail: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    paddingLeft: 6,
  },
  replyingRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  commentFooter: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  opBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 6,
  },
  opBadgeText: { fontSize: 10, fontWeight: "700" },
});
