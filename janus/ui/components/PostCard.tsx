import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { Post } from "../../core/model";
import { useTheme } from "../theme";
import { useSettings } from "../SettingsContext";
import { compactNumber, relativeTime } from "../format";
import { Markdown } from "./Markdown";
import { InlineVideo } from "./InlineVideo";
import { PollView } from "./PollView";
import { openExternal, isHttpUrl, hostname } from "../links";

function clampRatio(r?: number): number {
  if (!r || !Number.isFinite(r)) return 1.6;
  return Math.min(Math.max(r, 0.6), 2.2);
}

export interface PostCardProps {
  post: Post;
  onPress: () => void;
  /**
   * Open the in-app image viewer at the given image index. When omitted (e.g.
   * isolated tests) image taps fall back to opening the URL externally.
   */
  onOpenImage?: (images: string[], index: number) => void;
  /** Dense single-row layout (thumbnail on the right). Default false (comfortable). */
  compact?: boolean;
  /**
   * Show a small origin tag — used in merged feeds. Reddit shows "reddit" (one
   * host); Lemmy shows its actual instance (hexbear.net, lemmy.ml, …) so a post
   * is attributed to where it surfaced from, not a generic "lemmy".
   */
  showSource?: boolean;
}

export const PostCard = React.memo(function PostCard({
  post,
  onPress,
  onOpenImage,
  compact = false,
  showSource = false,
}: PostCardProps) {
  const t = useTheme();
  const { settings } = useSettings();
  const sourceColor =
    post.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const image = post.media.find(
    (m) => m.kind === "image" || m.kind === "gallery",
  );
  const imageUri = isHttpUrl(image?.thumbnailUrl)
    ? image!.thumbnailUrl
    : isHttpUrl(image?.url)
      ? image!.url
      : undefined;
  const link = post.media.find((m) => m.kind === "link");
  // The off-site URL of a link post, if any. A link post can also carry a
  // preview image, so this is what decides "link post" — not the media kind.
  const externalUrl = post.externalLink ?? (link ? link.url : undefined);
  // Native (Reddit-hosted / direct) video. HLS preferred, mp4 fallback.
  const video = post.media.find((m) => m.kind === "video");
  const videoUri = video
    ? isHttpUrl(video.hlsUrl)
      ? video.hlsUrl
      : isHttpUrl(video.url)
        ? video.url
        : undefined
    : undefined;
  const bodyPreview =
    !imageUri && !externalUrl ? post.body.text?.trim() : undefined;
  // Every full-resolution image/gallery URL, for the in-app viewer.
  const galleryImages = post.media
    .filter((m) => m.kind === "image" || m.kind === "gallery")
    .map((m) => (isHttpUrl(m.url) ? m.url : m.thumbnailUrl))
    .filter((u): u is string => isHttpUrl(u));
  const isLinkPost = isHttpUrl(externalUrl);
  const isVideo = !!videoUri && !isLinkPost;
  const videoPoster =
    imageUri ??
    (isHttpUrl(video?.thumbnailUrl) ? video!.thumbnailUrl : undefined);
  // Tapping a thumbnail: a video opens the post (where it plays); a link post
  // clicks through to the LINK (even when it has a preview image); an image-only
  // post opens the in-app image viewer. Distinct from tapping the card body.
  const openThumb = () => {
    if (isVideo) {
      onPress();
    } else if (isLinkPost) {
      void openExternal(externalUrl!);
    } else if (galleryImages.length) {
      if (onOpenImage) onOpenImage(galleryImages, 0);
      else void openExternal(galleryImages[0]);
    }
  };
  const thumbA11y = isVideo
    ? "Play video"
    : isLinkPost
      ? "Open link"
      : "View image";
  // Spoilers always blur; NSFW blur is user-controlled (Blur NSFW setting).
  const obscured = (post.isNSFW && settings.blurNsfw) || post.isSpoiler;
  const obscureLabel = post.isNSFW ? "NSFW" : "SPOILER";
  const hasIcon = isHttpUrl(post.community.icon);

  const a11y =
    `${post.community.handle}, ${relativeTime(post.createdAt)}` +
    `${post.isNSFW ? ", NSFW" : ""}${post.isStickied ? ", pinned" : ""}. ` +
    `${post.title}. ${post.scoreHidden ? "" : `${compactNumber(post.score)} points, `}` +
    `${compactNumber(post.commentCount)} comments, by ${post.author.handle}`;

  const originLabel = post.source === "reddit" ? "reddit" : post.instance;
  const sourceTag = showSource ? (
    <View
      style={[
        styles.sourceTag,
        { backgroundColor: sourceColor, borderRadius: t.radius.sm },
      ]}
    >
      <Text style={[t.type.small, styles.sourceTagText]} numberOfLines={1}>
        {originLabel}
      </Text>
    </View>
  ) : null;

  const header = (
    <View
      style={styles.headerRow}
      importantForAccessibility="no-hide-descendants"
    >
      {hasIcon ? (
        <Image
          source={{ uri: post.community.icon }}
          style={[styles.avatar, { borderColor: sourceColor }]}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.dot, { backgroundColor: sourceColor }]} />
      )}
      <Text
        style={[
          t.type.meta,
          {
            color: t.colors.text,
            fontWeight: "600",
            flexShrink: 1,
            marginLeft: hasIcon ? 8 : 7,
          },
        ]}
        numberOfLines={1}
      >
        {post.community.handle}
      </Text>
      {sourceTag}
      <View style={styles.headerTrail}>
        <Text style={[t.type.small, { color: t.colors.textTertiary }]}>
          · {relativeTime(post.createdAt)}
        </Text>
        {post.isStickied ? (
          <Ionicons
            name="pin"
            size={12}
            color={t.colors.lemmy}
            style={{ marginLeft: 6 }}
          />
        ) : null}
      </View>
    </View>
  );

  const footer = (
    <View
      style={[styles.footer, compact ? null : { marginTop: t.spacing.md }]}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={[
          t.type.meta,
          { color: t.colors.textSecondary, fontWeight: "600" },
        ]}
      >
        {post.scoreHidden ? "• points" : `${compactNumber(post.score)} points`}
      </Text>
      <View
        style={[
          styles.stat,
          { marginLeft: compact ? t.spacing.md : t.spacing.lg },
        ]}
      >
        <Ionicons
          name="chatbubble-outline"
          size={14}
          color={t.colors.textTertiary}
        />
        <Text
          style={[
            t.type.meta,
            { color: t.colors.textSecondary, marginLeft: 5 },
          ]}
        >
          {compactNumber(post.commentCount)}
        </Text>
      </View>
      {post.saved ? (
        <Ionicons
          name="bookmark"
          size={14}
          color={t.colors.accent}
          style={{ marginLeft: compact ? t.spacing.md : t.spacing.lg }}
        />
      ) : null}
      <View style={{ flex: 1 }} />
      <Text
        style={[
          t.type.small,
          { color: t.colors.textTertiary, flexShrink: 1, marginLeft: 8 },
        ]}
        numberOfLines={1}
      >
        {post.author.handle}
      </Text>
    </View>
  );

  const cardStyle = ({ pressed }: { pressed: boolean }) => [
    styles.card,
    {
      backgroundColor: pressed ? t.colors.cardPressed : t.colors.card,
      borderColor: t.colors.border,
      borderRadius: t.radius.lg,
      marginHorizontal: t.spacing.md,
      marginVertical: t.spacing.sm / 2,
    },
    compact ? { padding: t.spacing.md } : { padding: t.spacing.lg },
  ];

  // --- Compact: meta + title + footer on the left, a small thumbnail on the right.
  if (compact) {
    const thumbUri =
      imageUri ??
      videoPoster ??
      (isHttpUrl(link?.thumbnailUrl) ? link!.thumbnailUrl : undefined);
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Opens the post"
        style={cardStyle}
      >
        <View style={styles.compactRow}>
          <View style={styles.compactMain}>
            {header}
            <Text
              style={[
                t.type.body,
                { color: t.colors.text, fontWeight: "600", marginTop: 4 },
              ]}
              numberOfLines={2}
            >
              {post.title}
            </Text>
            <View style={{ marginTop: 6 }}>{footer}</View>
          </View>
          {thumbUri ? (
            <Pressable
              onPress={openThumb}
              accessibilityRole={isLinkPost ? "link" : "imagebutton"}
              accessibilityLabel={thumbA11y}
              style={styles.compactThumbWrap}
            >
              <Image
                source={{ uri: thumbUri }}
                style={[
                  styles.compactThumb,
                  {
                    borderRadius: t.radius.md,
                    backgroundColor: t.colors.skeleton,
                  },
                ]}
                contentFit="cover"
                recyclingKey={post.id}
                blurRadius={obscured ? 30 : 0}
                transition={150}
              />
              {obscured ? (
                <View
                  style={[styles.compactObscure, { borderRadius: t.radius.md }]}
                  pointerEvents="none"
                >
                  <Ionicons name="eye-off" size={16} color="#fff" />
                </View>
              ) : isVideo ? (
                <View style={styles.compactPlay} pointerEvents="none">
                  <Ionicons name="play" size={16} color="#fff" />
                </View>
              ) : null}
            </Pressable>
          ) : link ? (
            <Pressable
              onPress={() => openExternal(link.url)}
              accessibilityRole="link"
              accessibilityLabel={`Open link: ${hostname(link.url)}`}
              style={[
                styles.compactThumb,
                styles.compactLinkBox,
                {
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                },
              ]}
            >
              <Ionicons name="link" size={20} color={t.colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  }

  // --- Comfortable: full-width media, generous spacing.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the post"
      style={cardStyle}
    >
      {header}

      <Text
        style={[
          t.type.title,
          { color: t.colors.text, marginTop: t.spacing.sm },
        ]}
        numberOfLines={3}
      >
        {post.title}
      </Text>

      {post.flair?.text ? (
        <View
          style={[
            styles.flair,
            {
              backgroundColor:
                post.flair.backgroundColor || t.colors.bgElevated,
              borderColor: t.colors.border,
            },
          ]}
        >
          <Text
            style={[
              t.type.small,
              { color: post.flair.textColor || t.colors.textSecondary },
            ]}
            numberOfLines={1}
          >
            {post.flair.text}
          </Text>
        </View>
      ) : null}

      {isVideo ? (
        <View style={{ marginTop: t.spacing.md }}>
          <InlineVideo
            uri={videoUri!}
            poster={videoPoster}
            aspectRatio={clampRatio(video?.aspectRatio)}
            obscured={obscured}
            obscureLabel={obscureLabel}
          />
        </View>
      ) : imageUri ? (
        <Pressable
          onPress={openThumb}
          accessibilityRole={isLinkPost ? "link" : "imagebutton"}
          accessibilityLabel={`${thumbA11y}. ${post.isNSFW ? "NSFW. " : ""}`}
          style={{ marginTop: t.spacing.md }}
        >
          <Image
            source={{ uri: imageUri }}
            style={[
              styles.image,
              {
                aspectRatio: clampRatio(image?.aspectRatio),
                borderRadius: t.radius.md,
                backgroundColor: t.colors.skeleton,
              },
            ]}
            contentFit="cover"
            recyclingKey={post.id}
            blurRadius={obscured ? 55 : 0}
            transition={150}
          />
          {obscured ? (
            <View
              style={[styles.obscure, { borderRadius: t.radius.md }]}
              pointerEvents="none"
            >
              <Ionicons name="eye-off" size={18} color="#fff" />
              <Text style={[t.type.meta, { color: "#fff", marginTop: 4 }]}>
                {obscureLabel} · tap to view
              </Text>
            </View>
          ) : null}
        </Pressable>
      ) : link ? (
        <Pressable
          onPress={() => openExternal(link.url)}
          accessibilityRole="link"
          accessibilityLabel={`Open link: ${post.openGraph?.title ?? hostname(link.url)}`}
          style={[
            styles.linkChip,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
            },
          ]}
        >
          {isHttpUrl(link.thumbnailUrl) ? (
            <Image
              source={{ uri: link.thumbnailUrl }}
              style={styles.linkThumb}
              contentFit="cover"
            />
          ) : (
            <View
              style={[
                styles.linkThumb,
                {
                  backgroundColor: t.colors.skeleton,
                  alignItems: "center",
                  justifyContent: "center",
                },
              ]}
            >
              <Ionicons name="link" size={18} color={t.colors.textTertiary} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            {post.openGraph?.title ? (
              <Text
                style={[t.type.meta, { color: t.colors.text }]}
                numberOfLines={2}
              >
                {post.openGraph.title}
              </Text>
            ) : null}
            <Text
              style={[
                t.type.small,
                {
                  color: t.colors.textTertiary,
                  marginTop: post.openGraph?.title ? 2 : 0,
                },
              ]}
              numberOfLines={1}
            >
              {hostname(link.url)}
            </Text>
          </View>
          <Ionicons
            name="open-outline"
            size={16}
            color={t.colors.textTertiary}
          />
        </Pressable>
      ) : bodyPreview ? (
        <View style={{ marginTop: t.spacing.sm }} pointerEvents="none">
          <Markdown
            source={bodyPreview}
            numberOfLines={3}
            color={t.colors.textSecondary}
          />
        </View>
      ) : null}

      {post.poll ? (
        <View pointerEvents="none">
          <PollView poll={post.poll} />
        </View>
      ) : null}

      {footer}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerTrail: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 6,
    flexShrink: 0,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  avatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  sourceTag: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    flexShrink: 0,
    maxWidth: 120,
  },
  sourceTagText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.2,
  },
  flair: {
    alignSelf: "flex-start",
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  image: { width: "100%", maxHeight: 360 },
  obscure: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  linkChip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    padding: 8,
  },
  linkThumb: { width: 44, height: 44, borderRadius: 8 },
  footer: { flexDirection: "row", alignItems: "center" },
  stat: { flexDirection: "row", alignItems: "center" },
  // compact
  compactRow: { flexDirection: "row", alignItems: "flex-start" },
  compactMain: { flex: 1, minWidth: 0 },
  compactThumbWrap: { marginLeft: 12 },
  compactThumb: { width: 60, height: 60 },
  compactLinkBox: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    marginLeft: 12,
  },
  compactObscure: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  compactPlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
