import React, { useEffect } from "react";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  type Theme as NavTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import {
  AdapterProvider,
  type AdapterMap,
  useAdapters,
} from "./AdapterContext";
import { FeedScreen } from "./screens/FeedScreen";
import { PostScreen } from "./screens/PostScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SourceSwitcher } from "./components/SourceSwitcher";
import { AccountButton } from "./components/AccountButton";
import { RedditLoginModal } from "./components/RedditLoginModal";
import { LemmyLoginModal } from "./components/LemmyLoginModal";
import LemmySession from "../sources/lemmy/LemmySession";
import type { RootStackParamList } from "./types";
import { palettes } from "./theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Renders whichever login flow was requested: Reddit's WebView or Lemmy's credentials sheet. */
function LoginHost() {
  const { loginSource, adapters, clearLogin, bumpAccountVersion } =
    useAdapters();
  if (loginSource === "reddit") {
    return (
      <RedditLoginModal
        adapter={adapters.reddit}
        onClose={clearLogin}
        onSuccess={() => {
          clearLogin();
          bumpAccountVersion();
        }}
      />
    );
  }
  if (loginSource === "lemmy") {
    return (
      <LemmyLoginModal
        adapter={adapters.lemmy}
        onClose={clearLogin}
        onSuccess={(account, jwt) => {
          // Persist the JWT so the session survives relaunches (see SessionRestorer).
          void LemmySession.save({
            instance: account.instance,
            username: account.username,
            jwt,
          });
          clearLogin();
          bumpAccountVersion();
        }}
      />
    );
  }
  return null;
}

/** On launch, rehydrate a stored Lemmy session into the adapter (best-effort). */
function SessionRestorer() {
  const { adapters, bumpAccountVersion } = useAdapters();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await LemmySession.load();
      if (!stored || cancelled) return;
      try {
        const account = await adapters.lemmy.restore({
          source: "lemmy",
          jwt: stored.jwt,
        });
        if (!cancelled && !account.isGuest) bumpAccountVersion();
        else if (!cancelled) await LemmySession.clear(); // JWT was stale
      } catch {
        if (!cancelled) await LemmySession.clear();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

export function JanusRoot({ adapters }: { adapters: AdapterMap }) {
  const scheme = useColorScheme() ?? "dark";
  const colors = scheme === "light" ? palettes.light : palettes.dark;
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.bg,
      card: colors.bgElevated,
      text: colors.text,
      border: colors.border,
      primary: colors.accent,
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AdapterProvider adapters={adapters} initialSource="lemmy">
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.bgElevated },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen
              name="Feed"
              component={FeedScreen}
              options={{
                headerTitle: () => <SourceSwitcher />,
                headerRight: () => <AccountButton />,
              }}
            />
            <Stack.Screen
              name="Post"
              component={PostScreen}
              options={{ title: "Post" }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={({ route }) => ({ title: route.params.handle })}
            />
          </Stack.Navigator>
        </NavigationContainer>
        <SessionRestorer />
        <LoginHost />
      </AdapterProvider>
    </SafeAreaProvider>
  );
}
