import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import CookieManager from "@preeternal/react-native-cookie-manager";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import type { SourceAdapter, AccountRef } from "../../core/adapter";
import { useTheme } from "../theme";
import RedditCookies from "../../../utils/RedditCookies";

// While the WebView is on one of these, the user hasn't logged in yet. Once it
// navigates anywhere else (the post-login redirect), login has completed.
const ALLOWED_URLS = ["reddit.com/login", "redditinc.com/policies", "reddit.com/policies"];

/**
 * Reddit login via WebView. The user signs in on Reddit's own page (we never
 * see the password); on success Reddit sets `reddit_session` in the shared
 * cookie jar, which the adapter's transport then sends automatically. We detect
 * completion two ways (per Hydra): a navigation away from the login/policy
 * pages, and a 500ms poll for the session cookie.
 */
export function RedditLoginModal({
  adapter,
  onSuccess,
  onClose,
}: {
  adapter: SourceAdapter;
  onSuccess: (account: AccountRef) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const finished = useRef(false);

  const finish = async () => {
    if (finished.current) return;
    finished.current = true;
    setBusy(true);
    try {
      const cookies = await CookieManager.get("https://www.reddit.com");
      const sessionCookie = cookies?.reddit_session?.value ?? "";
      const { account, secret } = await adapter.completeLogin({ mode: "webview", capturedCookie: sessionCookie });
      if (secret.source === "reddit") await RedditCookies.saveSessionCookies(account.username);
      onSuccess(account);
    } catch (e) {
      finished.current = false;
      setBusy(false);
      setError(e instanceof Error ? e.message : "Login failed. Please try again.");
    }
  };

  useEffect(() => {
    const id = setInterval(async () => {
      if (await RedditCookies.hasSessionCookieBeenSet()) finish();
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.bg, zIndex: 100 }]}>
      <SafeAreaView style={styles.fill}>
        <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
          <Text style={[t.type.title, { color: t.colors.text }]}>Log in to Reddit</Text>
          <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Cancel login">
            <Ionicons name="close" size={24} color={t.colors.text} />
          </Pressable>
        </View>
        {error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={36} color={t.colors.danger} />
            <Text style={[t.type.body, { color: t.colors.text, textAlign: "center", marginTop: 12, maxWidth: 300 }]}>{error}</Text>
            <Pressable
              onPress={onClose}
              style={[styles.retry, { backgroundColor: t.colors.accent, borderRadius: t.radius.pill }]}
              accessibilityRole="button"
            >
              <Text style={[t.type.meta, { color: "#fff" }]}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            source={{ uri: "https://www.reddit.com/login?dest=https://www.reddit.com/" }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            onLoadStart={(e) => {
              const url = e.nativeEvent.url;
              if (!ALLOWED_URLS.some((u) => url.includes(u))) finish();
            }}
            onMessage={() => {}}
            style={styles.fill}
          />
        )}
        {busy ? (
          <View style={[styles.overlay, { backgroundColor: t.colors.overlay }]}>
            <ActivityIndicator color="#fff" />
            <Text style={[t.type.meta, { color: "#fff", marginTop: 10 }]}>Finishing sign-in…</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  retry: { marginTop: 20, paddingHorizontal: 22, paddingVertical: 10 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
