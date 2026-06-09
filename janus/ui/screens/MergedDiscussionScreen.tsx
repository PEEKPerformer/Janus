import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import type { Comment, Post } from "../../core/model";
import type { JanusId, SourceKind } from "../../core/ids";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useAsync } from "../hooks";
import { compactNumber } from "../format";
import { SourcePill } from "../components/SourcePill";
import { CommentItem } from "../components/CommentItem";
import { LoadingView, ErrorView } from "../components/StateViews";
import { buildCommentTree, flattenVisible } from "../../core/comment-tree";

type Props = NativeStackScreenProps<RootStackParamList, "MergedDiscussion">;

// Cap how many comments each side renders inline — this is a "read the room"
// overview, not a full thread. The section header links to the real post.
const PER_SECTION = 50;

type Filter = "all" | SourceKind;

interface Section {
  post: Post;
  comments: Comment[];
}

/**
 * The whole web's take on one thing. When the same link/image is posted across
 * Reddit and Lemmy, this shows every community's discussion in one scroll, each
 * comment tagged by where it lives — without faking a single merged tree (those
 * are genuinely separate conversations with separate id-spaces). Read + collapse
 * here; tap a section header to jump into that post to vote or reply on its home
 * network. This is the cross-network payoff no single-network app can offer.
 */
export function MergedDiscussionScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { adapterForEntity } = useAdapters();
  const posts = route.params.posts;
  const lead = posts[0];
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<JanusId>>(new Set());
  const toggle = (id: JanusId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const postKey = posts.map((p) => p.id).join(",");
  const { data, loading, error, reload } = useAsync<Section[]>(async () => {
    const settled = await Promise.allSettled(
      posts.map((p) => adapterForEntity(p).getComments(p.id, {})),
    );
    return posts.map((p, i) => ({
      post: p,
      comments:
        settled[i].status === "fulfilled"
          ? (settled[i] as PromiseFulfilledResult<{ items: Comment[] }>).value
              .items
          : [],
    }));
  }, [postKey]);

  const sourcesPresent = useMemo(
    () => Array.from(new Set(posts.map((p) => p.source))),
    [postKey],
  );
  const showFilter = sourcesPresent.length > 1;
  const sections = (data ?? []).filter(
    (s) => filter === "all" || s.post.source === filter,
  );

  const SEGMENTS: { id: Filter; label: string }[] = [
    { id: "all", label: "Both" },
    ...sourcesPresent.map((s) => ({
      id: s,
      label: s === "reddit" ? "Reddit" : "Lemmy",
    })),
  ];

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={26} color={t.colors.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text
              style={[t.type.title, { color: t.colors.text }]}
              numberOfLines={1}
            >
              Discussions
            </Text>
            <Text
              style={[t.type.small, { color: t.colors.textTertiary }]}
              numberOfLines={1}
            >
              {posts.length} communities across both networks
            </Text>
          </View>
        </View>

        {showFilter ? (
          <View
            style={[styles.segments, { borderBottomColor: t.colors.border }]}
          >
            {SEGMENTS.map((s) => {
              const active = filter === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setFilter(s.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: active
                        ? t.colors.accentActive
                        : t.colors.bgElevated,
                      borderColor: active
                        ? t.colors.accentActive
                        : t.colors.border,
                      borderRadius: t.radius.pill,
                    },
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
                  >
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {loading ? (
          <LoadingView label="Gathering discussions…" />
        ) : error ? (
          <ErrorView error={error} onRetry={reload} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Text
              style={[
                t.type.body,
                {
                  color: t.colors.text,
                  fontWeight: "700",
                  paddingHorizontal: 16,
                  paddingTop: 12,
                },
              ]}
              numberOfLines={3}
            >
              {lead.title}
            </Text>

            {sections.map((section) => (
              <DiscussionSection
                key={section.post.id}
                section={section}
                collapsed={collapsed}
                onToggle={toggle}
                onOpen={() =>
                  navigation.navigate("Post", { post: section.post })
                }
              />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function DiscussionSection({
  section,
  collapsed,
  onToggle,
  onOpen,
}: {
  section: Section;
  collapsed: Set<JanusId>;
  onToggle: (id: JanusId) => void;
  onOpen: () => void;
}) {
  const t = useTheme();
  const { post, comments } = section;
  const all = useMemo(
    () => flattenVisible(buildCommentTree(comments), collapsed, new Set()),
    [comments, collapsed],
  );
  const shown = all.slice(0, PER_SECTION);

  return (
    <View style={{ marginTop: 14 }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.community.handle} discussion`}
        style={[
          styles.sectionHead,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
          },
        ]}
      >
        <SourcePill source={post.source} instance={post.instance} size="xs" />
        <Text
          style={[
            t.type.meta,
            { color: t.colors.text, fontWeight: "700", flex: 1, marginLeft: 8 },
          ]}
          numberOfLines={1}
        >
          {post.community.handle}
        </Text>
        <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
          {compactNumber(post.commentCount)} comments
        </Text>
        <Ionicons
          name="open-outline"
          size={15}
          color={t.colors.accent}
          style={{ marginLeft: 8 }}
        />
      </Pressable>

      {comments.length === 0 ? (
        <Text
          style={[t.type.small, { color: t.colors.textTertiary, padding: 16 }]}
        >
          No comments here yet.
        </Text>
      ) : (
        shown.map((vc) => (
          <CommentItem key={vc.comment.id} item={vc} onToggle={onToggle} />
        ))
      )}
      {all.length > shown.length ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="Open full discussion"
          style={styles.more}
        >
          <Text
            style={[t.type.meta, { color: t.colors.accent, fontWeight: "600" }]}
          >
            Open full discussion ({compactNumber(all.length - shown.length)}{" "}
            more) →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segments: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  more: { paddingHorizontal: 16, paddingVertical: 12 },
});
