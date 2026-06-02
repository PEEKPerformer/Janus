import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";

/**
 * Header-right account affordance. For Reddit it opens the WebView login (or
 * shows the signed-in username). Lemmy browses fine anonymously and its login
 * (credentials) isn't wired yet, so there it's just a quiet guest indicator.
 */
export function AccountButton() {
  const t = useTheme();
  const { adapter, activeSource, requestLogin, accountVersion } = useAdapters();
  void accountVersion; // subscribe to post-login re-render
  const account = adapter.account;
  const color = activeSource === "reddit" ? t.colors.reddit : t.colors.lemmy;

  if (activeSource === "lemmy") {
    return <Ionicons name="person-circle-outline" size={26} color={t.colors.textTertiary} accessibilityLabel="Browsing Lemmy as guest" />;
  }

  if (account.isGuest) {
    return (
      <Pressable
        onPress={() => requestLogin("reddit")}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Sign in to Reddit"
        style={styles.signIn}
      >
        <Ionicons name="log-in-outline" size={18} color={color} />
        <Text style={[t.type.meta, { color, marginLeft: 4, fontWeight: "600" }]}>Sign in</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.row} accessibilityLabel={`Signed in as ${account.username}`}>
      <Ionicons name="person-circle" size={22} color={color} />
      <Text style={[t.type.meta, { color: t.colors.text, marginLeft: 4 }]} numberOfLines={1}>
        {account.username}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  signIn: { flexDirection: "row", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", maxWidth: 140 },
});
