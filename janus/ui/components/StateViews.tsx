import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { JanusError } from "../../core/errors";

export function LoadingView({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? "Loading"}>
      <ActivityIndicator color={t.colors.accent} />
      {label ? <Text style={[t.type.meta, { color: t.colors.textSecondary, marginTop: t.spacing.md }]}>{label}</Text> : null}
    </View>
  );
}

function humanError(error: Error): { title: string; detail: string } {
  if (error instanceof JanusError) {
    switch (error.code) {
      case "NOT_AUTHENTICATED":
        return { title: "Sign in required", detail: "Log in to an account to do that." };
      case "RATE_LIMITED":
        return { title: "Slow down", detail: "The server is rate-limiting requests. Try again shortly." };
      case "GATED_CONTENT":
        return { title: "Gated content", detail: "This community needs to be accepted before viewing." };
      case "NOT_FOUND":
        return { title: "Not found", detail: "We couldn't find that." };
      case "NETWORK":
        return { title: "Connection problem", detail: "Couldn't reach the server. Check your connection and retry." };
      default:
        return { title: "Something went wrong", detail: error.message };
    }
  }
  return { title: "Something went wrong", detail: error.message || "Unexpected error." };
}

export function ErrorView({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const t = useTheme();
  const { title, detail } = humanError(error);
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={40} color={t.colors.textTertiary} />
      <Text style={[t.type.title, { color: t.colors.text, marginTop: t.spacing.md, textAlign: "center" }]}>{title}</Text>
      <Text style={[t.type.body, { color: t.colors.textSecondary, marginTop: t.spacing.xs, textAlign: "center", maxWidth: 300 }]}>
        {detail}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: t.colors.accent, opacity: pressed ? 0.8 : 1, borderRadius: t.radius.pill },
          ]}
        >
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={[t.type.meta, { color: "#fff", marginLeft: 6 }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyView({ title, detail, icon = "documents-outline" }: { title: string; detail?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={40} color={t.colors.textTertiary} />
      <Text style={[t.type.title, { color: t.colors.text, marginTop: t.spacing.md, textAlign: "center" }]}>{title}</Text>
      {detail ? (
        <Text style={[t.type.body, { color: t.colors.textSecondary, marginTop: t.spacing.xs, textAlign: "center", maxWidth: 300 }]}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  retry: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 10, marginTop: 20 },
});
