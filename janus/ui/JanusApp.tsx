import React from "react";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme, DefaultTheme, type Theme as NavTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AdapterProvider, type AdapterMap, useAdapters } from "./AdapterContext";
import { FeedScreen } from "./screens/FeedScreen";
import { PostScreen } from "./screens/PostScreen";
import { SourceSwitcher } from "./components/SourceSwitcher";
import { AccountButton } from "./components/AccountButton";
import { RedditLoginModal } from "./components/RedditLoginModal";
import type { RootStackParamList } from "./types";
import { palettes } from "./theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Renders the Reddit WebView login as an overlay when login is requested. */
function LoginHost() {
  const { loginSource, adapters, clearLogin, bumpAccountVersion } = useAdapters();
  if (loginSource !== "reddit") return null;
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
              options={{ headerTitle: () => <SourceSwitcher />, headerRight: () => <AccountButton /> }}
            />
            <Stack.Screen name="Post" component={PostScreen} options={{ title: "Post" }} />
          </Stack.Navigator>
        </NavigationContainer>
        <LoginHost />
      </AdapterProvider>
    </SafeAreaProvider>
  );
}
