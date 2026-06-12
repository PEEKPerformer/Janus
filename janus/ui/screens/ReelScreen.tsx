import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import type { Post } from "../../core/model";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import { useSettings } from "../SettingsContext";
import { compactNumber, relativeTime } from "../format";
import { isHttpUrl, openExternal } from "../links";
import { shareImage, saveImageToLibrary } from "../shareMedia";
import { applyVote } from "../swipeVote";
import { Vote } from "../../core/vote";
import { isConnectivityError } from "../../core/errors";
import { isOffline } from "../../app/offline";
import { enqueueVote } from "../../app/outbox";

type Props = NativeStackScreenProps<RootStackParamList, "Reel">;

/**
 * A single playable slide. A reel post can mix several images and videos (a
 * Reddit gallery, a Lemmy single image, a Reddit-hosted video). We keep the
 * source's own media order so a gallery reads left-to-right as posted.
 */
interface ReelSlide {
  type: "image" | "video";
  uri: string;
  poster?: string;
  /** Silent looping clip (Reddit gif-as-mp4): muted, no transport controls. */
  isGif?: boolean;
  isNSFW: boolean;
}

/** Source-agnostic: turn any Post's media into playable reel slides. */
function reelSlides(post: Post): ReelSlide[] {
  const slides: ReelSlide[] = [];
  for (const m of post.media) {
    if (m.kind === "video") {
      const uri = isHttpUrl(m.hlsUrl)
        ? m.hlsUrl
        : isHttpUrl(m.url)
          ? m.url
          : undefined;
      if (uri)
        slides.push({
          type: "video",
          uri,
          poster: isHttpUrl(m.thumbnailUrl) ? m.thumbnailUrl : undefined,
          isGif: m.isGif,
          isNSFW: m.isNSFW,
        });
    } else if (m.kind === "image" || m.kind === "gallery") {
      const uri = isHttpUrl(m.url)
        ? m.url
        : isHttpUrl(m.thumbnailUrl)
          ? m.thumbnailUrl
          : undefined;
      if (uri) slides.push({ type: "image", uri, isNSFW: m.isNSFW });
    }
  }
  return slides;
}

/** A post belongs in the reel only if it has at least one playable slide. */
function hasReelMedia(post: Post): boolean {
  return reelSlides(post).length > 0;
}

interface VoteState {
  userVote: Vote;
  score: number;
  saved: boolean;
}

/**
 * TikTok-style media reel. Swipe UP/DOWN to move between posts, swipe LEFT/RIGHT
 * to page through a post's gallery, with native video/GIF playback. Works over
 * the merged Reddit + Lemmy feed — every page is just a {@link Post}, so a
 * subreddit gallery and a Lemmy image sit in the same vertical scroll.
 *
 * Only the active page autoplays; off-screen pages are virtualized away by the
 * FlatList (windowSize), which releases their video players.
 */
export function ReelScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { adapterForEntity } = useAdapters();
  const { settings, set } = useSettings();

  const { posts, postId } = route.params;
  const reelPosts = useMemo(() => posts.filter(hasReelMedia), [posts]);
  // Show the reveal toggle only when blur is on and there's actually NSFW here.
  const hasNsfw = useMemo(
    () => reelPosts.some((p) => p.isNSFW || p.media.some((m) => m.isNSFW)),
    [reelPosts],
  );
  const showRevealToggle = settings.blurNsfw && hasNsfw;
  const start = Math.max(
    0,
    reelPosts.findIndex((p) => p.id === postId),
  );

  // Measure the viewport so paging snap and item height agree exactly.
  const [pageH, setPageH] = useState(winH);
  const [activeIndex, setActiveIndex] = useState(start);

  // Optimistic vote/save overlay, keyed by post id (survives page recycling).
  const [overlay, setOverlay] = useState<Record<string, VoteState>>({});
  const effective = (p: Post): VoteState =>
    overlay[p.id] ?? { userVote: p.userVote, score: p.score, saved: p.saved };

  const vote = (post: Post, target: Vote) => {
    const cur = effective(post);
    const voted = applyVote(
      { userVote: cur.userVote, score: cur.score },
      target,
    );
    setOverlay((o) => ({ ...o, [post.id]: { ...voted, saved: cur.saved } }));
    // Offline / transient drop: keep the optimistic state, queue for landing.
    if (isOffline()) {
      enqueueVote(post.id, voted.userVote);
      return;
    }
    adapterForEntity(post)
      .vote(post.id, voted.userVote)
      .then((res) =>
        setOverlay((o) => ({
          ...o,
          [post.id]: {
            userVote: res.userVote,
            score: res.score,
            saved: o[post.id]?.saved ?? cur.saved,
          },
        })),
      )
      .catch((e) => {
        if (isConnectivityError(e)) {
          enqueueVote(post.id, voted.userVote);
          return;
        }
        setOverlay((o) => {
          const next = { ...o };
          delete next[post.id];
          return next;
        });
      });
  };

  const save = (post: Post) => {
    const cur = effective(post);
    const nextSaved = !cur.saved;
    setOverlay((o) => ({ ...o, [post.id]: { ...cur, saved: nextSaved } }));
    adapterForEntity(post)
      .save(post.id, nextSaved)
      .catch(() =>
        setOverlay((o) => ({
          ...o,
          [post.id]: { ...(o[post.id] ?? cur), saved: cur.saved },
        })),
      );
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / pageH);
    if (i !== activeIndex) setActiveIndex(i);
  };

  if (reelPosts.length === 0) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={{ color: "#fff" }}>No media to show</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.emptyBtn}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.fill}
      onLayout={(e) => setPageH(e.nativeEvent.layout.height)}
    >
      <FlatList
        data={reelPosts}
        keyExtractor={(p) => p.id}
        renderItem={({ item, index }) => (
          <ReelPage
            post={item}
            vote={effective(item)}
            active={index === activeIndex}
            height={pageH}
            onUpvote={() => vote(item, Vote.Up)}
            onDownvote={() => vote(item, Vote.Down)}
            onSave={() => save(item)}
            onOpenPost={() => navigation.navigate("Post", { post: item })}
            bottomInset={insets.bottom}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({
          length: pageH,
          offset: pageH * i,
          index: i,
        })}
        initialScrollIndex={start}
        onMomentumScrollEnd={onMomentumScrollEnd}
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={1}
        decelerationRate="fast"
      />

      {/* Close — sits above every page. */}
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close reel"
        style={[styles.close, { top: insets.top + 6 }]}
      >
        <Ionicons name="chevron-down" size={28} color="#fff" />
      </Pressable>

      {/* Reveal-all NSFW toggle — one tap instead of unblurring every image. */}
      {showRevealToggle ? (
        <Pressable
          onPress={() => set({ revealNsfwInReel: !settings.revealNsfwInReel })}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={
            settings.revealNsfwInReel
              ? "Blur NSFW media"
              : "Reveal NSFW media in this gallery"
          }
          style={[styles.reveal, { top: insets.top + 6 }]}
        >
          <Ionicons
            name={settings.revealNsfwInReel ? "eye-off" : "eye"}
            size={22}
            color="#fff"
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function ReelPage({
  post,
  vote,
  active,
  height,
  onUpvote,
  onDownvote,
  onSave,
  onOpenPost,
  bottomInset,
}: {
  post: Post;
  vote: VoteState;
  active: boolean;
  height: number;
  onUpvote: () => void;
  onDownvote: () => void;
  onSave: () => void;
  onOpenPost: () => void;
  bottomInset: number;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const slides = useMemo(() => reelSlides(post), [post]);
  const [mediaIndex, setMediaIndex] = useState(0);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== mediaIndex) setMediaIndex(i);
  };

  const sourceColor =
    post.source === "reddit" ? t.colors.reddit : t.colors.lemmy;
  const sourceBadge = post.source === "reddit" ? "reddit" : post.instance;
  const current = slides[mediaIndex] ?? slides[0];

  const onShare = () => {
    if (!current) return;
    if (current.type === "image") void shareImage(current.uri);
    else void openExternal(current.uri);
  };
  const onDownload = () => {
    if (current?.type === "image") void saveImageToLibrary(current.uri);
  };

  return (
    <View style={[styles.page, { height, width }]}>
      {slides.length > 1 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
        >
          {slides.map((s, i) => (
            <ReelMedia
              key={`${s.uri}-${i}`}
              slide={s}
              width={width}
              height={height}
              active={active && i === mediaIndex}
            />
          ))}
        </ScrollView>
      ) : current ? (
        <ReelMedia
          slide={current}
          width={width}
          height={height}
          active={active}
        />
      ) : null}

      {/* Gallery position dots */}
      {slides.length > 1 ? (
        <View
          style={[styles.dots, { top: height * 0.12 }]}
          pointerEvents="none"
        >
          {slides.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === mediaIndex ? "#fff" : "rgba(255,255,255,0.4)",
                },
              ]}
            />
          ))}
        </View>
      ) : null}

      {/* Right action rail — vote / comments / save / share */}
      <View
        style={[styles.rail, { bottom: bottomInset + 120 }]}
        pointerEvents="box-none"
      >
        <RailButton
          icon={
            vote.userVote === Vote.Up
              ? "arrow-up-circle"
              : "arrow-up-circle-outline"
          }
          tint={vote.userVote === Vote.Up ? t.colors.upvote : "#fff"}
          label={post.scoreHidden ? "•" : compactNumber(vote.score)}
          onPress={onUpvote}
          a11y="Upvote"
        />
        <RailButton
          icon={
            vote.userVote === Vote.Down
              ? "arrow-down-circle"
              : "arrow-down-circle-outline"
          }
          tint={vote.userVote === Vote.Down ? t.colors.downvote : "#fff"}
          onPress={onDownvote}
          a11y="Downvote"
        />
        <RailButton
          icon="chatbubble-outline"
          tint="#fff"
          label={compactNumber(post.commentCount)}
          onPress={onOpenPost}
          a11y="Open comments"
        />
        <RailButton
          icon={vote.saved ? "bookmark" : "bookmark-outline"}
          tint={vote.saved ? t.colors.accent : "#fff"}
          onPress={onSave}
          a11y={vote.saved ? "Unsave" : "Save"}
        />
        {current?.type === "image" ? (
          <RailButton
            icon="download-outline"
            tint="#fff"
            onPress={onDownload}
            a11y="Save to Photos"
          />
        ) : null}
        <RailButton
          icon="share-outline"
          tint="#fff"
          onPress={onShare}
          a11y="Share"
        />
      </View>

      {/* Bottom caption — community, title, meta. Tapping opens the post. */}
      <Pressable
        onPress={onOpenPost}
        accessibilityRole="button"
        accessibilityLabel={`${post.title}. Open post.`}
        style={[styles.caption, { bottom: bottomInset + 16 }]}
      >
        <View style={styles.captionRow}>
          {isHttpUrl(post.community.icon) ? (
            <Image
              source={{ uri: post.community.icon }}
              style={[styles.commIcon, { borderColor: sourceColor }]}
              contentFit="cover"
            />
          ) : (
            <View
              style={[
                styles.commIcon,
                styles.commIconFallback,
                { borderColor: sourceColor },
              ]}
            >
              <Ionicons
                name={post.source === "reddit" ? "logo-reddit" : "planet"}
                size={12}
                color={sourceColor}
              />
            </View>
          )}
          <Text style={styles.commHandle} numberOfLines={1}>
            {post.community.handle}
          </Text>
          <View style={[styles.badge, { backgroundColor: sourceColor }]}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {sourceBadge}
            </Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={3}>
          {post.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {post.author.handle} · {relativeTime(post.createdAt)}
        </Text>
      </Pressable>
    </View>
  );
}

function ReelMedia({
  slide,
  width,
  height,
  active,
}: {
  slide: ReelSlide;
  width: number;
  height: number;
  active: boolean;
}) {
  const { settings } = useSettings();
  const [revealed, setRevealed] = useState(false);
  // The session-wide reveal toggle skips per-image taps; a single tap still
  // reveals just this image when the toggle is off.
  const obscure =
    slide.isNSFW &&
    settings.blurNsfw &&
    !settings.revealNsfwInReel &&
    !revealed;

  const media =
    slide.type === "video" ? (
      <ReelVideo
        uri={slide.uri}
        active={active && !obscure}
        isGif={slide.isGif}
        width={width}
        height={height}
      />
    ) : (
      // expo-image animates GIFs natively, so a .gif image "just works" here.
      <Image
        source={{ uri: slide.uri }}
        style={{ width, height }}
        contentFit="contain"
        blurRadius={obscure ? 60 : 0}
        transition={120}
        accessibilityLabel="Image"
      />
    );

  if (!obscure) return <View style={{ width, height }}>{media}</View>;

  return (
    <Pressable
      onPress={() => setRevealed(true)}
      accessibilityRole="button"
      accessibilityLabel="NSFW. Tap to reveal."
      style={{ width, height }}
    >
      {media}
      <View style={styles.nsfw} pointerEvents="none">
        <Ionicons name="eye-off" size={26} color="#fff" />
        <Text style={styles.nsfwText}>NSFW · tap to reveal</Text>
      </View>
    </Pressable>
  );
}

/**
 * One reel video. Loops and autoplays while it's the active slide, pauses
 * otherwise; native controls give the platform transport bar (iOS AVKit /
 * Android ExoPlayer) so scrubbing/fullscreen feel native. HLS or progressive
 * mp4 both work — the player is fed whatever the adapter resolved.
 */
function ReelVideo({
  uri,
  active,
  isGif,
  width,
  height,
}: {
  uri: string;
  active: boolean;
  isGif?: boolean;
  width: number;
  height: number;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    // GIF semantics: there's no audio track worth surfacing and no timeline
    // worth scrubbing — just loop silently like every other reddit client.
    p.muted = !!isGif;
  });
  const startedRef = useRef(false);

  useEffect(() => {
    try {
      if (active) {
        player.play();
        startedRef.current = true;
      } else if (startedRef.current) {
        player.pause();
      }
    } catch {
      /* player may be released mid-transition */
    }
  }, [active, player]);

  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls={!isGif}
      fullscreenOptions={{ enable: !isGif }}
    />
  );
}

function RailButton({
  icon,
  tint,
  label,
  onPress,
  a11y,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label?: string;
  onPress: () => void;
  a11y: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={styles.railBtn}
    >
      <Ionicons name={icon} size={34} color={tint} />
      {label ? (
        <Text style={styles.railLabel} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center" },
  emptyBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  page: { backgroundColor: "#000", justifyContent: "center" },
  close: {
    position: "absolute",
    left: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  reveal: {
    position: "absolute",
    right: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  dots: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  rail: {
    position: "absolute",
    right: 8,
    alignItems: "center",
    gap: 18,
  },
  railBtn: { alignItems: "center", width: 52 },
  railLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 3,
  },
  caption: {
    position: "absolute",
    left: 14,
    right: 70,
  },
  captionRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  commIcon: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5 },
  commIconFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  commHandle: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    marginLeft: 8,
    flexShrink: 1,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowRadius: 4,
  },
  badge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    maxWidth: 120,
  },
  badgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.2,
  },
  title: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 5,
  },
  meta: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 6,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 4,
  },
  nsfw: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  nsfwText: { color: "#fff", marginTop: 6, fontWeight: "600" },
});
