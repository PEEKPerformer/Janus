// Janus app entry. Builds the real source adapters and mounts the unified UI.
// `@expo/metro-runtime` must be imported first for Fast Refresh.
import "@expo/metro-runtime";
import "expo-dev-client";

import { registerRootComponent } from "expo";
import React from "react";

import { JanusRoot } from "./ui/JanusApp";
import { createRedditAdapter } from "./sources/reddit";
import { createLemmyAdapter, DEFAULT_LEMMY_INSTANCE } from "./sources/lemmy";

const adapters = {
  reddit: createRedditAdapter(),
  lemmy: createLemmyAdapter(DEFAULT_LEMMY_INSTANCE),
};

function App() {
  return (
    <JanusRoot
      adapters={adapters}
      createLemmyAdapter={(instance) => createLemmyAdapter(instance)}
    />
  );
}

registerRootComponent(App);
