import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { Post } from "../../core/model";
import { useTheme } from "../theme";
import { compactNumber, relativeTime } from "../format";
import { Markdown } from "./Markdown";

function clampRatio(r?: number): number {
  if (!r || !Number.isFinite(r)) return 1.6;
  return Math.min(Math.max(r, 0.6), 2.2);
}

function hostname(url: string): string {
  const m = /^https?:\/\/([^/]+)/.exec(url);
  return m ? m[1].replace(/^www\./, "") : url;
}

export function PostCard({ post, onPress }: { post: Post; onPress: () => void }) {
  const t = useTheme();
  const sourceColor = post.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const image = post.media.find((m) => m.kind === "image" || m.kind === "gallery");
  const link = post.media.find((m) => m.kind === "link");
  const bodyPreview = post.body.text?.trim();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Post: ${post.title}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? t.colors.cardPressed : t.colors.card,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          marginHorizontal: t.spacing.md,
          marginVertical: t.spacing.sm / 2,
        },
      ]}
    >
      {/* Header: community + source + time */}
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: sourceColor }]} />
        <Text style={[t.type.meta, { color: t.colors.text, fontWeight: "600" }]} numberOfLines={1}>
          {post.community.handle}
        </Text>
        <Text style={[t.type.small, { color: t.colors.textTertiary, marginLeft: 6 }]}>· {relativeTime(post.createdAt)}</Text>
        {post.isStickied ? <Ionicons name="pin" size={12} color={t.colors.lemmy} style={{ marginLeft: 6 }} /> : null}
        {post.isNSFW ? (
          <Text style={[t.type.small, styles.nsfw, { color: t.colors.danger, borderColor: t.colors.danger }]}>NSFW</Text>
        ) : null}
      </View>

      {/* Title */}
      <Text style={[t.type.title, { color: t.colors.text, marginTop: t.spacing.sm }]} numberOfLines={3}>
        {post.title}
      </Text>

      {/* Media / link / text preview */}
      {image ? (
        <Image
          source={{ uri: image.thumbnailUrl ?? image.url }}
          style={[styles.image, { aspectRatio: clampRatio(image.aspectRatio), borderRadius: t.radius.md, backgroundColor: t.colors.skeleton }]}
          contentFit="cover"
          blurRadius={post.isNSFW ? 60 : 0}
          transition={150}
        />
      ) : link ? (
        <View style={[styles.linkChip, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.md }]}>
          {link.thumbnailUrl ? (
            <Image source={{ uri: link.thumbnailUrl }} style={styles.linkThumb} contentFit="cover" />
          ) : (
            <View style={[styles.linkThumb, { backgroundColor: t.colors.skeleton, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="link" size={18} color={t.colors.textTertiary} />
            </View>
          )}
          <Text style={[t.type.meta, { color: t.colors.textSecondary, flex: 1, marginLeft: 10 }]} numberOfLines={2}>
            {hostname(link.url)}
          </Text>
        </View>
      ) : bodyPreview ? (
        <View style={{ marginTop: t.spacing.sm }}>
          <Markdown source={bodyPreview} numberOfLines={3} color={t.colors.textSecondary} />
        </View>
      ) : null}

      {/* Footer: score + comments + author */}
      <View style={[styles.footer, { marginTop: t.spacing.md }]}>
        <View style={styles.stat}>
          <Ionicons name="arrow-up" size={15} color={t.colors.textTertiary} />
          <Text style={[t.type.meta, { color: t.colors.textSecondary, marginLeft: 3 }]}>
            {post.scoreHidden ? "•" : compactNumber(post.score)}
          </Text>
        </View>
        <View style={[styles.stat, { marginLeft: t.spacing.lg }]}>
          <Ionicons name="chatbubble-outline" size={14} color={t.colors.textTertiary} />
          <Text style={[t.type.meta, { color: t.colors.textSecondary, marginLeft: 4 }]}>{compactNumber(post.commentCount)}</Text>
        </View>
        {post.saved ? <Ionicons name="bookmark" size={14} color={t.colors.accent} style={{ marginLeft: t.spacing.lg }} /> : null}
        <View style={{ flex: 1 }} />
        <Text style={[t.type.small, { color: t.colors.textTertiary }]} numberOfLines={1}>
          {post.author.handle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: "row", alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  nsfw: { marginLeft: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: "hidden", fontSize: 10 },
  image: { width: "100%", marginTop: 12, maxHeight: 360 },
  linkChip: { flexDirection: "row", alignItems: "center", marginTop: 12, padding: 8 },
  linkThumb: { width: 44, height: 44, borderRadius: 8 },
  footer: { flexDirection: "row", alignItems: "center" },
  stat: { flexDirection: "row", alignItems: "center" },
});
