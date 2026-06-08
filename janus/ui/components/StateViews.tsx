import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { JanusError } from "../../core/errors";

export function LoadingView({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View
      style={styles.center}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? "Loading"}
    >
      <ActivityIndicator color={t.colors.accent} />
      {label ? (
        <Text
          style={[
            t.type.meta,
            { color: t.colors.textSecondary, marginTop: t.spacing.md },
          ]}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

function humanError(
  error: Error,
  sourceLabel?: string,
): { title: string; detail: string } {
  const where = sourceLabel ? ` ${sourceLabel}` : " the server";
  if (error instanceof JanusError) {
    switch (error.code) {
      case "NOT_AUTHENTICATED":
        return {
          title: "Sign in required",
          detail: "Log in to an account to do that.",
        };
      case "RATE_LIMITED":
        return {
          title: "Slow down",
          detail: "Requests are being rate-limited. Try again shortly.",
        };
      case "GATED_CONTENT":
        return {
          title: "Gated content",
          detail: "This community needs to be accepted before viewing.",
        };
      case "NOT_FOUND":
        return { title: "Not found", detail: "We couldn't find that." };
      case "FORBIDDEN":
        return {
          title: "Access blocked",
          detail: `${sourceLabel ?? "This source"} refused the request. On a real device this usually works.`,
        };
      case "NETWORK":
        return {
          title: "Connection problem",
          detail: `Couldn't reach${where}. Check your connection and retry.`,
        };
      default:
        return { title: "Something went wrong", detail: error.message };
    }
  }
  return {
    title: "Something went wrong",
    detail: error.message || "Unexpected error.",
  };
}

export function ErrorView({
  error,
  onRetry,
  sourceLabel,
}: {
  error: Error;
  onRetry?: () => void;
  sourceLabel?: string;
}) {
  const t = useTheme();
  const { title, detail } = humanError(error, sourceLabel);
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons
        name="cloud-offline-outline"
        size={40}
        color={t.colors.textTertiary}
      />
      <Text
        style={[
          t.type.title,
          {
            color: t.colors.text,
            marginTop: t.spacing.md,
            textAlign: "center",
          },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          t.type.body,
          {
            color: t.colors.textSecondary,
            marginTop: t.spacing.xs,
            textAlign: "center",
            maxWidth: 300,
          },
        ]}
      >
        {detail}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={({ pressed }) => [
            styles.retry,
            {
              backgroundColor: t.colors.accent,
              opacity: pressed ? 0.8 : 1,
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={[t.type.meta, { color: "#fff", marginLeft: 6 }]}>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyView({
  title,
  detail,
  icon = "documents-outline",
}: {
  title: string;
  detail?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={40} color={t.colors.textTertiary} />
      <Text
        style={[
          t.type.title,
          {
            color: t.colors.text,
            marginTop: t.spacing.md,
            textAlign: "center",
          },
        ]}
      >
        {title}
      </Text>
      {detail ? (
        <Text
          style={[
            t.type.body,
            {
              color: t.colors.textSecondary,
              marginTop: t.spacing.xs,
              textAlign: "center",
              maxWidth: 300,
            },
          ]}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** Shimmer placeholders matching PostCard geometry, for first-load + source switch. */
export function SkeletonFeed({ count = 6 }: { count?: number }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const sk = t.colors.skeleton;
  const bar = (w: number | string, h: number, mt: number, br = 4) => (
    <Animated.View
      style={{
        width: w as number,
        height: h,
        marginTop: mt,
        borderRadius: br,
        backgroundColor: sk,
        opacity: pulse,
      }}
    />
  );
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading posts">
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.skelCard,
            {
              backgroundColor: t.colors.card,
              borderColor: t.colors.border,
              borderRadius: t.radius.lg,
              marginHorizontal: t.spacing.md,
              marginVertical: t.spacing.sm / 2,
              padding: t.spacing.lg,
            },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Animated.View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: sk,
                opacity: pulse,
              }}
            />
            <Animated.View
              style={{
                width: 120,
                height: 11,
                marginLeft: 8,
                borderRadius: 4,
                backgroundColor: sk,
                opacity: pulse,
              }}
            />
          </View>
          {bar("86%", 15, 12)}
          {bar("55%", 15, 6)}
          {bar("100%", 150, 12, t.radius.md)}
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            {bar(40, 11, 0)}
            <View style={{ width: 16 }} />
            {bar(40, 11, 0)}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 20,
  },
  skelCard: { borderWidth: StyleSheet.hairlineWidth },
});
