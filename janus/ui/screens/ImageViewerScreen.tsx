import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { ScrollView } from "react-native-gesture-handler";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../types";
import { ZoomableImage } from "../components/ZoomableImage";
import { shareImage, saveImageToLibrary } from "../shareMedia";

type Props = NativeStackScreenProps<RootStackParamList, "ImageViewer">;

// How many pages either side of the current one stay mounted. A big gallery used
// to eager-mount every full-res page; we keep a small window and let the rest be
// cheap spacers, preloading the immediate neighbours so paging still feels instant.
const WINDOW = 1;

/**
 * Full-screen in-app image viewer (lightbox). Pinch / double-tap to zoom, pan
 * when zoomed, swipe to dismiss, and page horizontally through a gallery. The
 * share button sends the actual image file (see {@link shareImage}) so it can go
 * straight into a chat.
 */
export function ImageViewerScreen({ route, navigation }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { images, index = 0 } = route.params;
  const start = Math.min(Math.max(index, 0), Math.max(0, images.length - 1));

  const backdrop = useSharedValue(1);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const [current, setCurrent] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const close = () => navigation.goBack();

  // Warm the immediate neighbours so a page-turn lands on a decoded image.
  useEffect(() => {
    for (const i of [current - 1, current + 1]) {
      if (i >= 0 && i < images.length) void Image.prefetch(images[i]);
    }
  }, [current, images]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== current) setCurrent(i);
  };

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await shareImage(images[current]);
    } finally {
      setSharing(false);
    }
  };

  const onSave = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    const result = await saveImageToLibrary(images[current]);
    if (result === "saved") {
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1800);
    } else {
      setSaveState("idle");
    }
  };

  return (
    <View style={styles.fill}>
      <Animated.View
        style={[styles.backdrop, backdropStyle]}
        pointerEvents="none"
      />

      {images.length > 1 ? (
        <ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: start * width, y: 0 }}
          onMomentumScrollEnd={onScrollEnd}
        >
          {images.map((uri, i) =>
            Math.abs(i - current) <= WINDOW ? (
              <ZoomableImage
                key={`${uri}-${i}`}
                uri={uri}
                backdrop={backdrop}
                onRequestClose={close}
                onZoomChange={setZoomed}
              />
            ) : (
              <View key={`${uri}-${i}`} style={{ width }} />
            ),
          )}
        </ScrollView>
      ) : (
        <ZoomableImage
          uri={images[0]}
          backdrop={backdrop}
          onRequestClose={close}
          onZoomChange={setZoomed}
        />
      )}

      <View
        style={[styles.topBar, { paddingTop: insets.top + 4 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close image viewer"
          style={styles.iconBtn}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>

        {images.length > 1 ? (
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {current + 1} / {images.length}
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <Pressable
          onPress={onSave}
          hitSlop={12}
          disabled={saveState === "saving"}
          accessibilityRole="button"
          accessibilityLabel="Save image to Photos"
          style={styles.iconBtn}
        >
          {saveState === "saving" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons
              name={saveState === "saved" ? "checkmark" : "download-outline"}
              size={24}
              color="#fff"
            />
          )}
        </Pressable>

        <Pressable
          onPress={onShare}
          hitSlop={12}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel="Share image"
          style={styles.iconBtn}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="share-outline" size={24} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "transparent" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { flex: 1, alignItems: "center" },
  counterText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
