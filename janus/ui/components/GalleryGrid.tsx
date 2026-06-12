import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import type { Post, MediaItem } from "../../core/model";
import { useTheme } from "../theme";
import { isHttpUrl } from "../links";

export interface GalleryCell {
  post: Post;
  media: MediaItem;
  uri: string;
  key: string;
  /** Index of this image within its post's image list (for the viewer). */
  index: number;
}

/** Full-resolution image URLs for a post, for the in-app viewer. */
export function postImageUrls(post: Post): string[] {
  return post.media
    .filter((m) => m.kind === "image" || m.kind === "gallery")
    .map((m) => (isHttpUrl(m.url) ? m.url : m.thumbnailUrl))
    .filter((u): u is string => isHttpUrl(u));
}

function clampRatio(r?: number): number {
  if (!r || !Number.isFinite(r)) return 1;
  return Math.min(Math.max(r, 0.55), 2.0);
}

/** Pure: flatten a post list into media cells (each image/video of each post). */
export function galleryCells(posts: Post[]): GalleryCell[] {
  const cells: GalleryCell[] = [];
  for (const post of posts) {
    const items = post.media.filter(
      (m) => m.kind === "image" || m.kind === "gallery" || m.kind === "video",
    );
    items.forEach((media, i) => {
      // Videos render their poster still in the grid (the reel plays them);
      // a video with no poster has nothing to show in an image grid.
      const uri = (
        media.kind === "video"
          ? isHttpUrl(media.thumbnailUrl)
            ? media.thumbnailUrl
            : undefined
          : isHttpUrl(media.thumbnailUrl)
            ? media.thumbnailUrl
            : isHttpUrl(media.url)
              ? media.url
              : undefined
      ) as string | undefined;
      if (uri)
        cells.push({ post, media, uri, key: `${post.id}:${i}`, index: i });
    });
  }
  return cells;
}

/**
 * A masonry image grid over the feed. Cell heights are computed deterministically
 * from a fixed column width × the media aspectRatio, so there's none of the
 * relayout jank you get when masonry waits on image load / onLayout width.
 */
export function GalleryGrid({
  posts,
  onPressPost,
  onOpenImage,
  onOpenReel,
  onEndReached,
  refreshing,
  onRefresh,
  ListFooterComponent,
  contentBottomInset = 24,
}: {
  posts: Post[];
  onPressPost: (post: Post) => void;
  /** Open the in-app viewer at the tapped cell. Falls back to onPressPost. */
  onOpenImage?: (images: string[], index: number) => void;
  /**
   * Open the immersive TikTok-style reel at the tapped post. Preferred over
   * onOpenImage when provided, so the gallery grid feels like a reel surface.
   */
  onOpenReel?: (post: Post) => void;
  onEndReached: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  ListFooterComponent?: React.ComponentType | React.ReactElement | null;
  contentBottomInset?: number;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const colWidth = width / 2;
  const cells = useMemo(() => galleryCells(posts), [posts]);

  return (
    <FlashList
      data={cells}
      numColumns={2}
      masonry
      keyExtractor={(c) => c.key}
      getItemType={() => "img"}
      renderItem={({ item }) => {
        const obscured = item.post.isNSFW || item.post.isSpoiler;
        const h = (colWidth - 6) / clampRatio(item.media.aspectRatio);
        return (
          <Pressable
            onPress={() => {
              if (onOpenReel) {
                onOpenReel(item.post);
              } else if (onOpenImage) {
                const imgs = postImageUrls(item.post);
                onOpenImage(imgs.length ? imgs : [item.uri], item.index);
              } else {
                onPressPost(item.post);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={`${obscured ? (item.post.isNSFW ? "NSFW " : "Spoiler ") : ""}${
              item.media.kind === "video"
                ? item.media.isGif
                  ? "gif"
                  : "video"
                : "image"
            } post: ${item.post.title}`}
            style={styles.cell}
          >
            <Image
              source={{ uri: item.uri }}
              style={[
                styles.image,
                {
                  height: h,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.skeleton,
                },
              ]}
              contentFit="cover"
              recyclingKey={item.key}
              blurRadius={obscured ? 50 : 0}
              transition={120}
            />
            {obscured ? (
              <View style={styles.badge} pointerEvents="none">
                <Ionicons name="eye-off" size={16} color="#fff" />
              </View>
            ) : null}
            {item.media.kind === "video" ? (
              <View style={styles.mediaBadge} pointerEvents="none">
                {item.media.isGif ? (
                  <Text style={styles.mediaBadgeText}>GIF</Text>
                ) : (
                  <Ionicons name="play" size={13} color="#fff" />
                )}
              </View>
            ) : null}
          </Pressable>
        );
      }}
      onEndReached={onEndReached}
      onEndReachedThreshold={1.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListFooterComponent={ListFooterComponent}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 3, paddingBottom: contentBottomInset }}
    />
  );
}

const styles = StyleSheet.create({
  cell: { padding: 3 },
  image: { width: "100%" },
  badge: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  mediaBadge: {
    position: "absolute",
    bottom: 9,
    left: 9,
    minWidth: 26,
    height: 20,
    borderRadius: 5,
    paddingHorizontal: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  mediaBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
