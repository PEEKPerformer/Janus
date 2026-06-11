import React, { useEffect, useState } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  type Theme as NavTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AdapterProvider, useAdapters } from "./AdapterContext";
import { FeedScreen } from "./screens/FeedScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { PostScreen } from "./screens/PostScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ComposeScreen } from "./screens/ComposeScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { InboxScreen } from "./screens/InboxScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { MessageThreadScreen } from "./screens/MessageThreadScreen";
import { ImageViewerScreen } from "./screens/ImageViewerScreen";
import { ReelScreen } from "./screens/ReelScreen";
import { CommunityAboutScreen } from "./screens/CommunityAboutScreen";
import { WikiScreen } from "./screens/WikiScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ReadLaterScreen } from "./screens/ReadLaterScreen";
import { WatchesScreen } from "./screens/WatchesScreen";
import { PlaneModeScreen } from "./screens/PlaneModeScreen";
import { BriefingScreen } from "./screens/BriefingScreen";
import { AiLensScreen } from "./screens/AiLensScreen";
import { WatchResultsScreen } from "./screens/WatchResultsScreen";
import { MergedDiscussionScreen } from "./screens/MergedDiscussionScreen";
import { DeepLinkHandler } from "./DeepLinkHandler";
import { RedditLoginModal } from "./components/RedditLoginModal";
import { LemmyLoginModal } from "./components/LemmyLoginModal";
import RedditCookies from "../sources/reddit/RedditCookies";
import type { AccountManager } from "../app/AccountManager";
import type { RootStackParamList } from "./types";
import { palettes, ThemeProvider } from "./theme";
import { SettingsProvider, useSettings } from "./SettingsContext";
import { setImageViewerOpener } from "./imageViewer";

const Stack = createNativeStackNavigator<RootStackParamList>();
const navRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Renders whichever login flow was requested and feeds the result into the
 * AccountManager, which persists it as one of N accounts. Lemmy logs into the
 * focused instance (the user can switch instances inside the modal); Reddit's
 * session cookie is read back out of the jar to form the stored secret.
 */
function LoginHost() {
  const {
    loginSource,
    adapters,
    manager,
    clearLogin,
    bumpAccountVersion,
    changeLemmyInstance,
  } = useAdapters();

  if (loginSource === "reddit") {
    return (
      <RedditLoginModal
        adapter={adapters.reddit}
        onClose={clearLogin}
        onSuccess={async (account) => {
          const raw = await RedditCookies.getSessionCookies(account.username);
          await manager.onLoginSuccess(account, {
            source: "reddit",
            sessionCookie: raw ?? "",
          });
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
        onSuccess={async (account, jwt) => {
          await manager.onLoginSuccess(account, { source: "lemmy", jwt });
          changeLemmyInstance(account.instance); // focus what you logged into
          clearLogin();
          bumpAccountVersion();
        }}
      />
    );
  }
  return null;
}

/**
 * The navigation tree, themed from the user's appearance preference. Split out
 * so it can read {@link useSettings} (which only exists inside SettingsProvider)
 * to resolve the active colour scheme and font scale.
 */
function ThemedNavigation({ manager }: { manager: AccountManager }) {
  const { settings, ready } = useSettings();

  // Let navigation-free renderers (markdown images) open the image viewer.
  useEffect(() => {
    setImageViewerOpener((images, index) => {
      if (navRef.isReady()) navRef.navigate("ImageViewer", { images, index });
    });
    return () => setImageViewerOpener(null);
  }, []);
  const system = useColorScheme() === "light" ? "light" : "dark";
  const scheme =
    settings.appearance === "system" ? system : settings.appearance;

  const colors = scheme === "light" ? palettes.light : palettes.dark;

  // Hold the tree until persisted settings load, so screens that seed local
  // state from a preference (default feed/sort/layout) mount with the real
  // value rather than transiently with defaults.
  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <StatusBar style={scheme === "light" ? "dark" : "light"} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
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
    <ThemeProvider
      appearance={settings.appearance}
      fontScale={settings.fontScale}
      accent={settings.themeAccent}
      oledBlack={settings.oledBlack}
    >
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AdapterProvider manager={manager} initialSource="lemmy">
        <NavigationContainer ref={navRef} theme={navTheme}>
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
              options={{ headerShown: false }}
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
            <Stack.Screen
              name="Inbox"
              component={InboxScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Messages"
              component={MessagesScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="MessageThread"
              component={MessageThreadScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Stats"
              component={StatsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="History"
              component={HistoryScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ReadLater"
              component={ReadLaterScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Watches"
              component={WatchesScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Briefing"
              component={BriefingScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AiLens"
              component={AiLensScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="PlaneMode"
              component={PlaneModeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="WatchResults"
              component={WatchResultsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="MergedDiscussion"
              component={MergedDiscussionScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ImageViewer"
              component={ImageViewerScreen}
              options={{
                headerShown: false,
                presentation: "transparentModal",
                animation: "fade",
              }}
            />
            <Stack.Screen
              name="Reel"
              component={ReelScreen}
              options={{
                headerShown: false,
                presentation: "fullScreenModal",
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen
              name="CommunityAbout"
              component={CommunityAboutScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Wiki"
              component={WikiScreen}
              options={{ headerShown: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        <LoginHost />
        <DeepLinkHandler navRef={navRef} />
      </AdapterProvider>
    </ThemeProvider>
  );
}

export function JanusRoot({ manager }: { manager: AccountManager }) {
  const scheme = useColorScheme() ?? "dark";
  const [ready, setReady] = useState(false);

  // Restore every stored account (Reddit + each Lemmy instance) before mounting
  // the tree, so AdapterProvider sees the populated registry.
  useEffect(() => {
    let cancelled = false;
    manager
      .init()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [manager]);

  const colors = scheme === "light" ? palettes.light : palettes.dark;

  if (!ready) {
    return (
      <SafeAreaProvider>
        <StatusBar style={scheme === "light" ? "dark" : "light"} />
        <View
          style={{
            flex: 1,
            backgroundColor: colors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <ThemedNavigation manager={manager} />
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
