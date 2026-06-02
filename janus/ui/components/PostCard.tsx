import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { Post } from "../../core/model";
import { useTheme } from "../theme";
import { compactNumber, relativeTime } from "../format";
import { Markdown } from "./Markdown";
import { openExternal, isHttpUrl, hostname } from "../links";

function clampRatio(r?: number): number {
  if (!r || !Number.isFinite(r)) return 1.6;
  return Math.min(Math.max(r, 0.6), 2.2);
}

export const PostCard = React.memo(function PostCard({ post, onPress }: { post: Post; onPress: () => void }) {
  const t = useTheme();
  const sourceColor = post.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const image = post.media.find((m) => m.kind === "image" || m.kind === "gallery");
  const imageUri = isHttpUrl(image?.thumbnailUrl) ? image!.thumbnailUrl : isHttpUrl(image?.url) ? image!.url : undefined;
  const link = post.media.find((m) => m.kind === "link");
  const bodyPreview = !imageUri && !link ? post.body.text?.trim() : undefined;
  const obscured = post.isNSFW || post.isSpoiler;
  const obscureLabel = post.isNSFW ? "NSFW" : "SPOILER";
  const hasIcon = isHttpUrl(post.community.icon);

  const a11y =
    `${post.community.handle}, ${relativeTime(post.createdAt)}` +
    `${post.isNSFW ? ", NSFW" : ""}${post.isStickied ? ", pinned" : ""}. ` +
    `${post.title}. ${post.scoreHidden ? "" : `${compactNumber(post.score)} points, `}` +
    `${compactNumber(post.commentCount)} comments, by ${post.author.handle}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the post"
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
      {/* Header: community identity + source + time */}
      <View style={styles.headerRow} importantForAccessibility="no-hide-descendants">
        {hasIcon ? (
          <Image source={{ uri: post.community.icon }} style={[styles.avatar, { borderColor: sourceColor }]} contentFit="cover" />
        ) : (
          <View style={[styles.dot, { backgroundColor: sourceColor }]} />
        )}
        <Text style={[t.type.meta, { color: t.colors.text, fontWeight: "600", flexShrink: 1, marginLeft: hasIcon ? 8 : 7 }]} numberOfLines={1}>
          {post.community.handle}
        </Text>
        <View style={styles.headerTrail}>
          <Text style={[t.type.small, { color: t.colors.textTertiary }]}>· {relativeTime(post.createdAt)}</Text>
          {post.isStickied ? <Ionicons name="pin" size={12} color={t.colors.lemmy} style={{ marginLeft: 6 }} /> : null}
        </View>
      </View>

      <Text style={[t.type.title, { color: t.colors.text, marginTop: t.spacing.sm }]} numberOfLines={3}>
        {post.title}
      </Text>

      {post.flair?.text ? (
        <View style={[styles.flair, { backgroundColor: post.flair.backgroundColor || t.colors.bgElevated, borderColor: t.colors.border }]}>
          <Text style={[t.type.small, { color: post.flair.textColor || t.colors.textSecondary }]} numberOfLines={1}>
            {post.flair.text}
          </Text>
        </View>
      ) : null}

      {imageUri ? (
        <View style={{ marginTop: t.spacing.md }}>
          <Image
            source={{ uri: imageUri }}
            style={[styles.image, { aspectRatio: clampRatio(image?.aspectRatio), borderRadius: t.radius.md, backgroundColor: t.colors.skeleton }]}
            contentFit="cover"
            recyclingKey={post.id}
            blurRadius={obscured ? 55 : 0}
            transition={150}
          />
          {obscured ? (
            <View style={[styles.obscure, { borderRadius: t.radius.md }]} pointerEvents="none">
              <Ionicons name="eye-off" size={18} color="#fff" />
              <Text style={[t.type.meta, { color: "#fff", marginTop: 4 }]}>{obscureLabel} · tap to view</Text>
            </View>
          ) : null}
        </View>
      ) : link ? (
        <Pressable
          onPress={() => openExternal(link.url)}
          accessibilityRole="link"
          accessibilityLabel={`Open link: ${post.openGraph?.title ?? hostname(link.url)}`}
          style={[styles.linkChip, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.md }]}
        >
          {isHttpUrl(link.thumbnailUrl) ? (
            <Image source={{ uri: link.thumbnailUrl }} style={styles.linkThumb} contentFit="cover" />
          ) : (
            <View style={[styles.linkThumb, { backgroundColor: t.colors.skeleton, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="link" size={18} color={t.colors.textTertiary} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            {post.openGraph?.title ? (
              <Text style={[t.type.meta, { color: t.colors.text }]} numberOfLines={2}>
                {post.openGraph.title}
              </Text>
            ) : null}
            <Text style={[t.type.small, { color: t.colors.textTertiary, marginTop: post.openGraph?.title ? 2 : 0 }]} numberOfLines={1}>
              {hostname(link.url)}
            </Text>
          </View>
          <Ionicons name="open-outline" size={16} color={t.colors.textTertiary} />
        </Pressable>
      ) : bodyPreview ? (
        <View style={{ marginTop: t.spacing.sm }} pointerEvents="none">
          <Markdown source={bodyPreview} numberOfLines={3} color={t.colors.textSecondary} />
        </View>
      ) : null}

      {/* Footer: stats (read-only here; voting lives on the post screen) + author */}
      <View style={[styles.footer, { marginTop: t.spacing.md }]} importantForAccessibility="no-hide-descendants">
        <Text style={[t.type.meta, { color: t.colors.textSecondary, fontWeight: "600" }]}>
          {post.scoreHidden ? "• points" : `${compactNumber(post.score)} points`}
        </Text>
        <View style={[styles.stat, { marginLeft: t.spacing.lg }]}>
          <Ionicons name="chatbubble-outline" size={14} color={t.colors.textTertiary} />
          <Text style={[t.type.meta, { color: t.colors.textSecondary, marginLeft: 5 }]}>{compactNumber(post.commentCount)}</Text>
        </View>
        {post.saved ? <Ionicons name="bookmark" size={14} color={t.colors.accent} style={{ marginLeft: t.spacing.lg }} /> : null}
        <View style={{ flex: 1 }} />
        <Text style={[t.type.small, { color: t.colors.textTertiary, flexShrink: 1, marginLeft: 8 }]} numberOfLines={1}>
          {post.author.handle}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerTrail: { flexDirection: "row", alignItems: "center", marginLeft: 6, flexShrink: 0 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  avatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  flair: { alignSelf: "flex-start", marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  image: { width: "100%", maxHeight: 360 },
  obscure: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  linkChip: { flexDirection: "row", alignItems: "center", marginTop: 12, padding: 8 },
  linkThumb: { width: 44, height: 44, borderRadius: 8 },
  footer: { flexDirection: "row", alignItems: "center" },
  stat: { flexDirection: "row", alignItems: "center" },
});
