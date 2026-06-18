import React, { useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Image } from "expo-image";
import { SPRING } from "../motion";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DY = 120;
const DISMISS_VY = 800;

/**
 * One zoomable, pannable, swipe-to-dismiss image page — all on the UI thread via
 * react-native-reanimated + the modern Gesture API (120fps on ProMotion). Pinch,
 * pan, double-tap, and the dismiss-drag never touch the JS thread, so a heavy
 * feed never makes the lightbox stutter.
 *
 * Gestures:
 *  - pinch to zoom (1–4×), double-tap to toggle 1× / 2.5×
 *  - pan when zoomed (clamped to image bounds)
 *  - swipe in any direction at 1× to dismiss: the image tracks your finger, the
 *    backdrop fades proportionally, and on release a real throw flings it out
 *    (velocity-aware) while a short drag springs back
 *
 * At 1× the pan only claims vertical drags (failing horizontal ones) so a parent
 * paging ScrollView can move between gallery images; `onZoomChange` lets the
 * parent disable paging while zoomed. `backdrop` is a shared value owned by the
 * host screen so every page fades the one backdrop.
 */
export function ZoomableImage({
  uri,
  placeholder,
  backdrop,
  onRequestClose,
  onZoomChange,
}: {
  uri: string;
  /** Low-res URI shown (blurred) until the full image loads. */
  placeholder?: string;
  backdrop: SharedValue<number>;
  onRequestClose: () => void;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [zoomed, setZoomedState] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const setZoomed = (z: boolean) => {
    setZoomedState(z);
    onZoomChange?.(z);
  };

  const reset = () => {
    "worklet";
    scale.value = withSpring(1, SPRING.snappy);
    savedScale.value = 1;
    tx.value = withSpring(0, SPRING.snappy);
    ty.value = withSpring(0, SPRING.snappy);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const gesture = useMemo(() => {
    const clamp = (v: number, lo: number, hi: number) => {
      "worklet";
      return Math.min(hi, Math.max(lo, v));
    };

    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = clamp(savedScale.value * e.scale, 1, MAX_SCALE);
      })
      .onEnd(() => {
        savedScale.value = scale.value;
        if (scale.value <= 1.01) {
          reset();
          runOnJS(setZoomed)(false);
        } else {
          runOnJS(setZoomed)(true);
        }
      });

    let pan = Gesture.Pan()
      .maxPointers(1)
      .onUpdate((e) => {
        if (savedScale.value > 1.01) {
          const maxX = Math.max(0, ((savedScale.value - 1) * width) / 2);
          const maxY = Math.max(0, ((savedScale.value - 1) * height) / 2);
          tx.value = clamp(savedTx.value + e.translationX, -maxX, maxX);
          ty.value = clamp(savedTy.value + e.translationY, -maxY, maxY);
        } else {
          // 1×: track the finger and fade the backdrop with the pull distance.
          ty.value = e.translationY;
          tx.value = e.translationX * 0.5;
          backdrop.value = clamp(1 - Math.abs(e.translationY) / 400, 0.15, 1);
        }
      })
      .onEnd((e) => {
        if (savedScale.value > 1.01) {
          savedTx.value = tx.value;
          savedTy.value = ty.value;
          return;
        }
        if (Math.abs(e.translationY) > DISMISS_DY || e.velocityY > DISMISS_VY) {
          backdrop.value = withTiming(0, { duration: 160 });
          const dir = e.translationY >= 0 ? 1 : -1;
          ty.value = withTiming(dir * height, { duration: 200 }, (done) => {
            if (done) runOnJS(onRequestClose)();
          });
        } else {
          tx.value = withSpring(0, SPRING.snappy);
          ty.value = withSpring(0, { ...SPRING.snappy, velocity: e.velocityY });
          backdrop.value = withSpring(1, SPRING.gentle);
        }
      });
    // At 1× claim only vertical (dismiss), letting horizontal pass to the pager;
    // zoomed, claim both axes for panning.
    pan = zoomed
      ? pan.activeOffsetX([-5, 5]).activeOffsetY([-5, 5])
      : pan.activeOffsetY([-12, 12]).failOffsetX([-12, 12]);

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .onEnd(() => {
        if (savedScale.value > 1.01) {
          reset();
          runOnJS(setZoomed)(false);
        } else {
          scale.value = withSpring(DOUBLE_TAP_SCALE, SPRING.snappy);
          savedScale.value = DOUBLE_TAP_SCALE;
          runOnJS(setZoomed)(true);
        }
      });

    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [zoomed, width, height, uri]);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.page, { width, height }]}>
        <Animated.View style={[styles.fill, imgStyle]}>
          <Image
            source={{ uri }}
            placeholder={placeholder ? { uri: placeholder } : undefined}
            placeholderContentFit="contain"
            style={styles.fill}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
            accessibilityLabel="Image. Double-tap to zoom, swipe to close."
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: "center", justifyContent: "center" },
  fill: { flex: 1, width: "100%" },
});
