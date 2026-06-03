// Janus app entry. Builds the AccountManager (adapter registry) and mounts the
// unified UI. `@expo/metro-runtime` must be imported first for Fast Refresh.
import "@expo/metro-runtime";
import "expo-dev-client";
// Must load before any gesture-handler use (powers the image viewer gestures).
import "react-native-gesture-handler";

import { registerRootComponent } from "expo";
import React from "react";

import { JanusRoot } from "./ui/JanusApp";
import { AccountManager } from "./app/AccountManager";
import { createRedditAdapter } from "./sources/reddit";
import { createLemmyAdapter, DEFAULT_LEMMY_INSTANCE } from "./sources/lemmy";
import RedditCookies from "../utils/RedditCookies";

// One manager owns every adapter: the single Reddit adapter plus one per Lemmy
// instance the user logs into or browses. init() (run inside JanusRoot) restores
// all stored accounts on launch.
const manager = new AccountManager({
  factories: {
    createReddit: () => createRedditAdapter(),
    createLemmy: (instance, jwt) => createLemmyAdapter(instance, jwt),
  },
  defaultLemmyInstance: DEFAULT_LEMMY_INSTANCE,
  // Reddit's session lives in the WebView cookie jar; re-inject it before the
  // adapter re-validates on cold launch. Lemmy needs no hook (JWT is in-secret).
  onBeforeRestore: async (account) => {
    if (account.source === "reddit")
      await RedditCookies.restoreSessionCookies(account.username);
  },
});

function App() {
  return <JanusRoot manager={manager} />;
}

registerRootComponent(App);
