import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, useWindowDimensions } from "react-native";
import {
  PanGestureHandler,
  PinchGestureHandler,
  TapGestureHandler,
  State,
  type PanGestureHandlerStateChangeEvent,
  type PinchGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { Image } from "expo-image";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DY = 120;

/**
 * One zoomable, pannable, swipe-to-dismiss image page, built on the native
 * gesture recognizers from react-native-gesture-handler (pinch / pan / tap)
 * driving Animated values. This gives a far smoother pinch than hand-rolled
 * touch math.
 *
 * Gestures:
 *  - pinch to zoom (1–4×), double-tap to toggle 1× / 2.5×
 *  - pan when zoomed (clamped to image bounds)
 *  - swipe down at 1× to dismiss (fades the backdrop as you drag)
 *
 * At 1× the pan handler only claims vertical drags (failing horizontal ones),
 * so a parent paging ScrollView can move between gallery images; `onZoomChange`
 * lets the parent disable paging while zoomed.
 */
export function ZoomableImage({
  uri,
  backdropOpacity,
  onRequestClose,
  onZoomChange,
}: {
  uri: string;
  backdropOpacity: Animated.Value;
  onRequestClose: () => void;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);

  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const doubleTapRef = useRef(null);

  // Committed transform + live gesture deltas. All non-native so a JS listener
  // can fade the backdrop and so scale + translate stay on one driver.
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const scale = Animated.multiply(baseScale, pinchScale);
  const transX = useRef(new Animated.Value(0)).current;
  const transY = useRef(new Animated.Value(0)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  const last = useRef({ scale: 1, x: 0, y: 0 });

  const setZoom = (z: boolean) => {
    zoomedRef.current = z;
    setZoomed(z);
    onZoomChange?.(z);
  };

  // Fade the backdrop as you drag down at 1× (dismiss affordance).
  useEffect(() => {
    const id = panY.addListener(({ value }) => {
      if (!zoomedRef.current && value > 0) {
        backdropOpacity.setValue(Math.max(0.15, 1 - value / 400));
      }
    });
    return () => panY.removeListener(id);
  }, [panY, backdropOpacity]);

  const onPinchEvent = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: false },
  );

  const onPinchStateChange = (e: PinchGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      let next = last.current.scale * e.nativeEvent.scale;
      next = Math.min(MAX_SCALE, Math.max(1, next));
      last.current.scale = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
      if (next <= 1.01) {
        last.current.x = 0;
        last.current.y = 0;
        Animated.spring(transX, { toValue: 0, useNativeDriver: false }).start();
        Animated.spring(transY, { toValue: 0, useNativeDriver: false }).start();
        setZoom(false);
      } else {
        setZoom(true);
      }
    }
  };

  const onPanEvent = Animated.event(
    [{ nativeEvent: { translationX: panX, translationY: panY } }],
    { useNativeDriver: false },
  );

  const onPanStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState !== State.ACTIVE) return;
    const { translationX, translationY, velocityY } = e.nativeEvent;
    panX.setValue(0);
    panY.setValue(0);

    if (zoomedRef.current) {
      const s = last.current.scale;
      const maxX = Math.max(0, ((s - 1) * width) / 2);
      const maxY = Math.max(0, ((s - 1) * height) / 2);
      last.current.x = Math.min(
        maxX,
        Math.max(-maxX, last.current.x + translationX),
      );
      last.current.y = Math.min(
        maxY,
        Math.max(-maxY, last.current.y + translationY),
      );
      Animated.spring(transX, {
        toValue: last.current.x,
        useNativeDriver: false,
        bounciness: 2,
      }).start();
      Animated.spring(transY, {
        toValue: last.current.y,
        useNativeDriver: false,
        bounciness: 2,
      }).start();
      return;
    }

    // Not zoomed: a downward drag dismisses, otherwise spring back.
    if (translationY > DISMISS_DY || velocityY > 0.6) {
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: false,
      }).start(onRequestClose);
      return;
    }
    Animated.spring(transY, { toValue: 0, useNativeDriver: false }).start();
    Animated.spring(backdropOpacity, {
      toValue: 1,
      useNativeDriver: false,
    }).start();
  };

  const onDoubleTap = () => {
    if (last.current.scale > 1.01) {
      last.current = { scale: 1, x: 0, y: 0 };
      Animated.spring(baseScale, {
        toValue: 1,
        useNativeDriver: false,
      }).start();
      Animated.spring(transX, { toValue: 0, useNativeDriver: false }).start();
      Animated.spring(transY, { toValue: 0, useNativeDriver: false }).start();
      setZoom(false);
    } else {
      last.current.scale = DOUBLE_TAP_SCALE;
      Animated.spring(baseScale, {
        toValue: DOUBLE_TAP_SCALE,
        useNativeDriver: false,
      }).start();
      setZoom(true);
    }
  };

  // At 1× claim only vertical (dismiss), letting horizontal pass to the parent
  // pager; when zoomed claim both axes for panning.
  const panProps = zoomed
    ? {
        activeOffsetX: [-5, 5] as [number, number],
        activeOffsetY: [-5, 5] as [number, number],
      }
    : {
        activeOffsetY: [-12, 12] as [number, number],
        failOffsetX: [-12, 12] as [number, number],
      };

  return (
    <TapGestureHandler
      ref={doubleTapRef}
      numberOfTaps={2}
      maxDelayMs={260}
      onActivated={onDoubleTap}
    >
      <Animated.View style={[styles.page, { width, height }]}>
        <PinchGestureHandler
          ref={pinchRef}
          simultaneousHandlers={panRef}
          onGestureEvent={onPinchEvent}
          onHandlerStateChange={onPinchStateChange}
        >
          <Animated.View style={styles.fill}>
            <PanGestureHandler
              ref={panRef}
              simultaneousHandlers={pinchRef}
              minPointers={1}
              maxPointers={1}
              {...panProps}
              onGestureEvent={onPanEvent}
              onHandlerStateChange={onPanStateChange}
            >
              <Animated.View
                style={[
                  styles.fill,
                  {
                    transform: [
                      { translateX: Animated.add(transX, panX) },
                      { translateY: Animated.add(transY, panY) },
                      { scale },
                    ],
                  },
                ]}
              >
                <Image
                  source={{ uri }}
                  style={styles.fill}
                  contentFit="contain"
                  transition={120}
                  accessibilityLabel="Image. Double-tap to zoom, swipe down to close."
                />
              </Animated.View>
            </PanGestureHandler>
          </Animated.View>
        </PinchGestureHandler>
      </Animated.View>
    </TapGestureHandler>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: "center", justifyContent: "center" },
  fill: { flex: 1, width: "100%" },
});
