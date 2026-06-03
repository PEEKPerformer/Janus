import React from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useAdapters } from "../AdapterContext";
import RedditCookies from "../../../utils/RedditCookies";

/**
 * Header-right account affordance. When signed out it's a "Sign in" button that
 * opens the active source's login flow — Reddit's WebView or Lemmy's credentials
 * sheet. When signed in it shows the username. Both sources browse anonymously
 * until then.
 */
export function AccountButton() {
  const t = useTheme();
  const {
    adapter,
    activeSource,
    manager,
    requestLogin,
    bumpAccountVersion,
    accountVersion,
  } = useAdapters();
  void accountVersion; // subscribe to post-login re-render
  const account = adapter.account;
  const color = activeSource === "reddit" ? t.colors.reddit : t.colors.lemmy;

  const confirmLogout = () => {
    Alert.alert("Log out", `Sign out of ${account.username}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await manager.logout(account);
          if (account.source === "reddit")
            await RedditCookies.clearSessionCookies();
          bumpAccountVersion();
        },
      },
    ]);
  };

  if (account.isGuest) {
    return (
      <Pressable
        onPress={() => requestLogin(activeSource)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={
          activeSource === "reddit" ? "Sign in to Reddit" : "Sign in to Lemmy"
        }
        style={styles.signIn}
      >
        <Ionicons name="log-in-outline" size={18} color={color} />
        <Text
          style={[t.type.meta, { color, marginLeft: 4, fontWeight: "600" }]}
        >
          Sign in
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={confirmLogout}
      hitSlop={10}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`Signed in as ${account.username}. Tap to log out.`}
    >
      <Ionicons name="person-circle" size={22} color={color} />
      <Text
        style={[t.type.meta, { color: t.colors.text, marginLeft: 4 }]}
        numberOfLines={1}
      >
        {account.username}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  signIn: { flexDirection: "row", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", maxWidth: 140 },
});
