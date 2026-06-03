import React, { useCallback, useEffect, useState } from "react";
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
import { ComposeScreen } from "./screens/ComposeScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SourceSwitcher } from "./components/SourceSwitcher";
import { AccountButton } from "./components/AccountButton";
import { RedditLoginModal } from "./components/RedditLoginModal";
import { LemmyLoginModal } from "./components/LemmyLoginModal";
import LemmySession from "../sources/lemmy/LemmySession";
import LemmyInstance, {
  normalizeInstance,
} from "../sources/lemmy/LemmyInstance";
import type { SourceAdapter } from "../core/adapter";
import type { RootStackParamList } from "./types";
import { palettes } from "./theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Renders whichever login flow was requested: Reddit's WebView or Lemmy's credentials sheet. */
function LoginHost() {
  const {
    loginSource,
    adapters,
    clearLogin,
    bumpAccountVersion,
    changeLemmyInstance,
  } = useAdapters();
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
        onChangeInstance={changeLemmyInstance}
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

export function JanusRoot({
  adapters: initialAdapters,
  createLemmyAdapter,
}: {
  adapters: AdapterMap;
  /** Factory to rebuild the Lemmy adapter when the user switches instances. */
  createLemmyAdapter?: (instance: string) => SourceAdapter;
}) {
  const scheme = useColorScheme() ?? "dark";
  const [adapters, setAdapters] = useState<AdapterMap>(initialAdapters);

  // Swap in a freshly-built Lemmy adapter for the chosen instance, persist it,
  // and drop any session (it belonged to the previous server).
  const changeLemmyInstance = useCallback(
    (raw: string) => {
      if (!createLemmyAdapter) return;
      const instance = normalizeInstance(raw);
      if (!instance || instance === adapters.lemmy.instance) return;
      setAdapters((prev) => ({ ...prev, lemmy: createLemmyAdapter(instance) }));
      void LemmyInstance.save(instance);
      void LemmySession.clear();
    },
    [createLemmyAdapter, adapters.lemmy.instance],
  );

  // On launch, restore a previously-chosen instance.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await LemmyInstance.load();
      if (!cancelled && saved && saved !== initialAdapters.lemmy.instance)
        changeLemmyInstance(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <AdapterProvider
        adapters={adapters}
        initialSource="lemmy"
        onChangeLemmyInstance={changeLemmyInstance}
      >
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
            <Stack.Screen
              name="Compose"
              component={ComposeScreen}
              options={{ title: "New post", presentation: "modal" }}
            />
            <Stack.Screen
              name="Search"
              component={SearchScreen}
              options={{ headerShown: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        <SessionRestorer />
        <LoginHost />
      </AdapterProvider>
    </SafeAreaProvider>
  );
}
