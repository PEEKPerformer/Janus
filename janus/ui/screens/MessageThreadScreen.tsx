import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { useAdapters } from "../AdapterContext";
import { useFeed } from "../hooks";
import { useKeyboardHeight } from "../useKeyboardHeight";
import { useTheme } from "../theme";
import { Markdown } from "../components/Markdown";
import { SourcePill } from "../components/SourcePill";
import { ErrorView, SkeletonFeed } from "../components/StateViews";
import { relativeTime } from "../format";
import type { DirectMessage } from "../../core/model";

type Props = NativeStackScreenProps<RootStackParamList, "MessageThread">;

/**
 * One DM conversation, rendered as a chat: their messages left, yours right.
 * Sends optimistically append a local bubble (some backends — Lemmy — don't
 * echo your own sent messages back in the thread list).
 */
export function MessageThreadScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const { correspondentId, source, instance, handle } = route.params;
  const { adapterForEntity } = useAdapters();
  const adapter = adapterForEntity({ source, instance });

  const thread = useFeed<DirectMessage>(
    (page) => adapter.getMessageThread(correspondentId, page),
    [correspondentId, instance],
  );

  // Optimistic sent bubbles (id-deduped against whatever the backend echoes).
  const [pending, setPending] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const counter = useRef(0);

  const merged = [...thread.items, ...pending].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await adapter.sendMessage({ to: correspondentId, markdown: text });
      const optimistic: DirectMessage = {
        id: `local:${counter.current++}` as DirectMessage["id"],
        dedupKey: `local:${counter.current}` as DirectMessage["dedupKey"],
        source,
        instance,
        read: true,
        createdAt: Date.now(),
        from: {
          id: adapter.account.id,
          username: adapter.account.username,
          handle:
            source === "reddit"
              ? `u/${adapter.account.username}`
              : adapter.account.username,
          avatarUrl: adapter.account.avatarUrl,
        },
        to: { id: correspondentId, username: handle, handle },
        body: { text, markdown: text },
        fromMe: true,
      };
      setPending((p) => [...p, optimistic]);
      setDraft("");
    } catch {
      setNotice("Couldn't send — try again");
      setTimeout(() => setNotice(undefined), 2400);
    } finally {
      setSending(false);
    }
  }, [draft, sending, adapter, correspondentId, source, instance, handle]);

  const renderItem = ({ item }: { item: DirectMessage }) => {
    const mine = item.fromMe;
    return (
      <View
        style={[
          styles.bubbleRow,
          { justifyContent: mine ? "flex-end" : "flex-start" },
        ]}
      >
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: mine ? t.colors.accentActive : t.colors.card,
              borderColor: t.colors.border,
              borderTopRightRadius: mine ? 4 : 16,
              borderTopLeftRadius: mine ? 16 : 4,
            },
          ]}
        >
          <View pointerEvents="none">
            <Markdown
              source={item.body.text ?? ""}
              color={mine ? "#fff" : t.colors.text}
            />
          </View>
          <Text
            style={[
              styles.time,
              { color: mine ? "rgba(255,255,255,0.7)" : t.colors.textTertiary },
            ]}
          >
            {relativeTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  const header = (
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
      <Pressable
        onPress={() =>
          navigation.navigate("Profile", {
            userId: correspondentId,
            source,
            handle,
          })
        }
        style={styles.titleWrap}
        accessibilityRole="button"
        accessibilityLabel={`Open ${handle}'s profile`}
      >
        <Text
          style={[t.type.title, { color: t.colors.text }]}
          numberOfLines={1}
        >
          {handle}
        </Text>
        <SourcePill source={source} instance={instance} size="xs" />
      </Pressable>
    </View>
  );

  let body: React.ReactNode;
  if (thread.loading && merged.length === 0) body = <SkeletonFeed />;
  else if (thread.error && merged.length === 0)
    body = <ErrorView error={thread.error} onRetry={thread.refresh} />;
  else
    body = (
      <FlashList
        data={merged}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        onEndReached={thread.loadMore}
        onEndReachedThreshold={0.6}
        refreshing={thread.refreshing}
        onRefresh={thread.refresh}
        ListFooterComponent={<View style={{ height: 12 }} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
      />
    );

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {header}
      <View style={styles.fill}>{body}</View>
      {notice ? (
        <View
          style={[
            styles.toast,
            {
              bottom: (keyboard || insets.bottom) + 64,
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
            },
          ]}
        >
          <Text style={[t.type.meta, { color: t.colors.text }]}>{notice}</Text>
        </View>
      ) : null}
      <View
        style={[
          styles.composer,
          {
            borderTopColor: t.colors.border,
            backgroundColor: t.colors.bg,
            paddingBottom: keyboard > 0 ? 8 : insets.bottom + 8,
            marginBottom: keyboard,
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${handle}`}
          placeholderTextColor={t.colors.textTertiary}
          multiline
          style={[
            styles.input,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              color: t.colors.text,
            },
          ]}
          accessibilityLabel="Message text"
        />
        <Pressable
          onPress={send}
          disabled={sending || draft.trim().length === 0}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={[
            styles.send,
            {
              backgroundColor:
                draft.trim().length === 0
                  ? t.colors.bgElevated
                  : t.colors.accentActive,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons
              name="arrow-up"
              size={20}
              color={draft.trim().length === 0 ? t.colors.textTertiary : "#fff"}
            />
          )}
        </Pressable>
      </View>
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
  titleWrap: {
    flex: 1,
    marginLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bubbleRow: { flexDirection: "row", paddingHorizontal: 12, marginVertical: 3 },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  time: { fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
