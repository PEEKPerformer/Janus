import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useAggregateFeed, type AggregateSource } from "../hooks";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { SourcePill } from "../components/SourcePill";
import { ErrorView, EmptyView, SkeletonFeed } from "../components/StateViews";
import { relativeTime } from "../format";
import { buildId, type JanusId } from "../../core/ids";
import type { Notification } from "../../core/model";

type Props = NativeStackScreenProps<RootStackParamList, "Inbox">;
type Filter = "all" | "replies" | "mentions";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "replies", label: "Replies" },
  { id: "mentions", label: "Mentions" },
];

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  commentReply: "chatbubble-ellipses-outline",
  postReply: "chatbubble-ellipses-outline",
  mention: "at-outline",
  privateMessage: "mail-outline",
  modAction: "shield-outline",
  subscribed: "notifications-outline",
};

/** Reconstruct a navigable post id from a notification's context route. */
function notificationPostId(n: Notification): JanusId | null {
  const r = n.contextRoute;
  if (!r) return null;
  if (n.source === "reddit") {
    const m = /comments\/([a-z0-9]+)/i.exec(r.params.permalink ?? "");
    if (!m) return null;
    return buildId({
      source: "reddit",
      instance: n.instance,
      kind: "post",
      nativeId: m[1],
    });
  }
  const id = r.params.id;
  if (!id) return null;
  return buildId({
    source: "lemmy",
    instance: n.instance,
    kind: "post",
    nativeId: id,
  });
}

/**
 * Unified notifications: replies, mentions and mod actions from EVERY signed-in
 * account (Reddit + each Lemmy instance), merged newest-first with a provenance
 * pill on every row. Replies/mentions tap through to the post; private messages
 * open the conversation thread. DMs live behind the header chat button.
 */
export function InboxScreen({ navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { manager, adapterForEntity, accountVersion } = useAdapters();

  const [filter, setFilter] = useState<Filter>("all");
  const [readIds, setReadIds] = useState<Set<JanusId>>(new Set());
  const [opening, setOpening] = useState<JanusId | null>(null);

  const signedIn = useMemo(
    () => manager.signedInAdapters(),

    [manager, accountVersion],
  );
  const sources = useMemo<AggregateSource<Notification>[]>(
    () =>
      signedIn.map((a) => ({
        key: `${a.source}:${a.instance}`,
        // "messages" filter is intentionally excluded here — DMs have their own
        // conversation screen. The inbox is activity (replies/mentions/mod).
        fetch: (page) =>
          a.getInbox(filter === "all" ? "all" : filter, page).then((p) => ({
            ...p,
            items: p.items.filter((n) => n.kind !== "privateMessage"),
          })),
      })),
    [signedIn, filter],
  );

  const inbox = useAggregateFeed<Notification>(
    sources,
    (n) => n.id,
    (n) => n.createdAt,
    [sources.map((s) => s.key).join("|"), filter],
  );

  const markRead = async (n: Notification) => {
    if (readIds.has(n.id) || n.read) return;
    setReadIds((prev) => new Set(prev).add(n.id));
    try {
      await adapterForEntity({
        source: n.source,
        instance: n.instance,
      }).markRead(n.id, true);
    } catch {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.delete(n.id);
        return next;
      });
    }
  };

  const markAll = async () => {
    const ids = new Set(inbox.items.map((n) => n.id));
    setReadIds(ids);
    await Promise.allSettled(signedIn.map((a) => a.markAllRead()));
  };

  const openNotification = async (n: Notification) => {
    void markRead(n);
    if (n.kind === "privateMessage" && n.author) {
      navigation.navigate("MessageThread", {
        correspondentId: n.author.id,
        source: n.source,
        instance: n.instance,
        handle: n.author.handle,
      });
      return;
    }
    const postId = notificationPostId(n);
    if (!postId) return;
    setOpening(n.id);
    try {
      const adapter = adapterForEntity({
        source: n.source,
        instance: n.instance,
      });
      const post = await adapter.getPost(postId);
      navigation.navigate("Post", { post });
    } catch {
      /* best-effort — already marked read */
    } finally {
      setOpening(null);
    }
  };

  const header = (
    <View>
      <View
        style={[
          styles.bar,
          { paddingTop: insets.top + 8, borderBottomColor: t.colors.border },
        ]}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={t.colors.text} />
        </Pressable>
        <Text
          style={[
            t.type.title,
            { color: t.colors.text, flex: 1, marginLeft: 8 },
          ]}
        >
          Notifications
        </Text>
        <Pressable
          onPress={() => navigation.navigate("Messages")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Messages"
          style={{ marginRight: 16 }}
        >
          <Ionicons
            name="chatbubbles-outline"
            size={22}
            color={t.colors.text}
          />
        </Pressable>
        <Pressable
          onPress={markAll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Mark all as read"
        >
          <Text
            style={[t.type.meta, { color: t.colors.accent, fontWeight: "600" }]}
          >
            Mark all read
          </Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={f.label}
              style={[
                styles.tab,
                { borderBottomColor: active ? t.colors.accent : "transparent" },
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
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderItem = ({ item }: { item: Notification }) => {
    const unread = !item.read && !readIds.has(item.id);
    const tappable =
      item.kind === "privateMessage" || notificationPostId(item) !== null;
    return (
      <Pressable
        onPress={() => openNotification(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.kind} from ${item.author?.handle ?? "unknown"}${unread ? ", unread" : ""}`}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: t.colors.border,
            backgroundColor: pressed
              ? t.colors.cardPressed
              : unread
                ? t.colors.bgElevated
                : "transparent",
          },
        ]}
      >
        <Ionicons
          name={KIND_ICON[item.kind] ?? "notifications-outline"}
          size={18}
          color={unread ? t.colors.accent : t.colors.textTertiary}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.metaRow}>
            <Text
              style={[
                t.type.meta,
                {
                  color: t.colors.text,
                  fontWeight: unread ? "700" : "500",
                  flexShrink: 1,
                },
              ]}
              numberOfLines={1}
            >
              {item.author?.handle ?? "Notification"}
            </Text>
            <SourcePill
              source={item.source}
              instance={item.instance}
              size="xs"
            />
            <Text
              style={[
                t.type.small,
                { color: t.colors.textTertiary, marginLeft: 6 },
              ]}
            >
              {relativeTime(item.createdAt)}
            </Text>
          </View>
          {item.subject ? (
            <Text
              style={[
                t.type.small,
                { color: t.colors.textSecondary, marginTop: 1 },
              ]}
              numberOfLines={1}
            >
              {item.subject}
            </Text>
          ) : null}
          {item.body.text ? (
            <View style={{ marginTop: 3 }} pointerEvents="none">
              <Markdown
                source={item.body.text}
                numberOfLines={3}
                color={t.colors.textSecondary}
              />
            </View>
          ) : null}
        </View>
        {opening === item.id ? (
          <ActivityIndicator
            color={t.colors.accent}
            size="small"
            style={{ marginLeft: 8 }}
          />
        ) : unread ? (
          <View style={[styles.dot, { backgroundColor: t.colors.accent }]} />
        ) : tappable ? (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={t.colors.textTertiary}
            style={{ marginLeft: 6, marginTop: 2 }}
          />
        ) : null}
      </Pressable>
    );
  };

  let body: React.ReactNode;
  if (signedIn.length === 0)
    body = (
      <EmptyView
        title="Not signed in"
        detail="Sign in to a Reddit or Lemmy account to see notifications."
        icon="notifications-off-outline"
      />
    );
  else if (inbox.loading) body = <SkeletonFeed />;
  else if (inbox.error && inbox.items.length === 0)
    body = <ErrorView error={inbox.error} onRetry={inbox.refresh} />;
  else
    body = (
      <FlashList
        data={inbox.items}
        keyExtractor={(n) => n.id}
        extraData={`${readIds.size}:${opening}`}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyView
            title="All caught up"
            detail="No new notifications."
            icon="checkmark-done-outline"
          />
        }
        onEndReached={inbox.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={inbox.refreshing}
        onRefresh={inbox.refresh}
        ListFooterComponent={
          inbox.loadingMore ? (
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

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {header}
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "transparent",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8, marginTop: 6 },
});
