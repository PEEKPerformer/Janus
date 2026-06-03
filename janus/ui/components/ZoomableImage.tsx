import React, { useEffect, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";

const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DY = 120;

function touchDistance(touches: readonly { pageX: number; pageY: number }[]) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.hypot(dx, dy);
}

/**
 * One zoomable, pannable, swipe-to-dismiss image page, built on core Animated +
 * PanResponder (no react-native-gesture-handler / reanimated — neither is a
 * dependency). Gestures:
 *  - pinch (two fingers) to zoom, clamped 1–4×
 *  - double-tap to toggle 1× / 2.5×
 *  - pan when zoomed
 *  - swipe down at 1× to dismiss (fades the backdrop as you drag)
 *
 * Horizontal swipes at 1× are deliberately NOT captured, so a parent paging
 * ScrollView can move between gallery images; `onZoomChange` lets the parent
 * disable paging while a page is zoomed.
 */
export function ZoomableImage({
  uri,
  backdropOpacity,
  onRequestClose,
  onZoomChange,
  onTap,
}: {
  uri: string;
  /** Screen-level backdrop opacity, faded during a dismiss drag. */
  backdropOpacity: Animated.Value;
  onRequestClose: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  onTap?: () => void;
}) {
  const { width, height } = useWindowDimensions();

  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // Committed values, tracked via listeners so gestures can read them live.
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const panStart = useRef({ x: 0, y: 0 });
  const pinchBase = useRef<number | null>(null);
  const lastTap = useRef(0);
  const mode = useRef<"none" | "pan" | "pinch" | "dismiss">("none");

  useEffect(() => {
    const a = scale.addListener(({ value }) => (scaleRef.current = value));
    const b = tx.addListener(({ value }) => (txRef.current = value));
    const c = ty.addListener(({ value }) => (tyRef.current = value));
    return () => {
      scale.removeListener(a);
      tx.removeListener(b);
      ty.removeListener(c);
    };
  }, [scale, tx, ty]);

  const settle = (s: number, x: number, y: number) => {
    onZoomChange?.(s > 1.01);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: s,
        useNativeDriver: true,
        bounciness: 2,
      }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true, bounciness: 2 }),
    ]).start();
  };

  const clampTranslate = (s: number, x: number, y: number) => {
    const maxX = Math.max(0, ((s - 1) * width) / 2);
    const maxY = Math.max(0, ((s - 1) * height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, g) => {
        if (scaleRef.current > 1.01) return true; // zoomed → pan
        if (e.nativeEvent.touches.length >= 2) return true; // pinch
        // At 1×, capture only a clear downward drag (dismiss); leave horizontal
        // swipes to the parent paging ScrollView.
        return g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
      },
      onPanResponderGrant: () => {
        panStart.current = { x: txRef.current, y: tyRef.current };
        pinchBase.current = null;
        mode.current = "none";
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          mode.current = "pinch";
          const d = touchDistance(touches);
          if (pinchBase.current == null)
            pinchBase.current = d / (scaleRef.current || 1);
          const s = Math.min(
            MAX_SCALE,
            Math.max(0.8, d / (pinchBase.current || 1)),
          );
          scale.setValue(s);
        } else if (scaleRef.current > 1.01) {
          mode.current = "pan";
          tx.setValue(panStart.current.x + g.dx);
          ty.setValue(panStart.current.y + g.dy);
        } else if (g.dy > 0) {
          mode.current = "dismiss";
          ty.setValue(g.dy);
          backdropOpacity.setValue(Math.max(0.15, 1 - g.dy / 400));
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (mode.current === "dismiss") {
          if (g.dy > DISMISS_DY || g.vy > 0.6) {
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }).start(onRequestClose);
            return;
          }
          Animated.spring(ty, { toValue: 0, useNativeDriver: true }).start();
          Animated.spring(backdropOpacity, {
            toValue: 1,
            useNativeDriver: true,
          }).start();
        } else if (mode.current === "pinch" || mode.current === "pan") {
          const s = scaleRef.current < 1 ? 1 : scaleRef.current;
          const c =
            s <= 1
              ? { x: 0, y: 0 }
              : clampTranslate(s, txRef.current, tyRef.current);
          settle(s, c.x, c.y);
        }
        pinchBase.current = null;
        mode.current = "none";
      },
      onPanResponderTerminate: () => {
        mode.current = "none";
        pinchBase.current = null;
      },
    }),
  ).current;

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (scaleRef.current > 1.01) settle(1, 0, 0);
      else settle(DOUBLE_TAP_SCALE, 0, 0);
    } else {
      lastTap.current = now;
      onTap?.();
    }
  };

  return (
    <Animated.View
      style={[styles.page, { width, height }]}
      {...responder.panHandlers}
    >
      <Pressable
        onPress={handleTap}
        accessibilityRole="imagebutton"
        accessibilityLabel="Image. Double-tap to zoom, swipe down to close."
        style={styles.fill}
      >
        <Animated.View
          style={{
            flex: 1,
            transform: [{ translateX: tx }, { translateY: ty }, { scale }],
          }}
        >
          <Image
            source={{ uri }}
            style={styles.fill}
            contentFit="contain"
            transition={120}
          />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: "center", justifyContent: "center" },
  fill: { flex: 1, width: "100%" },
});
