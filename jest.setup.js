/* Jest setup: mock the few native-only UI deps so the component tree renders in
 * node. Domain/adapter logic is already covered without these. */
/* eslint-disable @typescript-eslint/no-require-imports */

// react-native-gesture-handler: install its jest mock so the handler components
// (used by the image viewer) render as plain views in node.
require("react-native-gesture-handler/jestSetup");

// FlashList -> a plain View that renders header, items (or empty), footer.
jest.mock("@shopify/flash-list", () => {
  const React = require("react");
  const { View } = require("react-native");
  const resolve = (C) =>
    typeof C === "function" ? React.createElement(C) : (C ?? null);
  const FlashList = ({
    data = [],
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
  }) =>
    React.createElement(
      View,
      null,
      resolve(ListHeaderComponent),
      data.length === 0
        ? resolve(ListEmptyComponent)
        : data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: keyExtractor ? keyExtractor(item, index) : index },
              renderItem({ item, index }),
            ),
          ),
      resolve(ListFooterComponent),
    );
  return { FlashList };
});

// expo-image -> a View (we only assert structure/labels, not pixels), plus the
// static cache + share helpers the Settings/viewer actions call.
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  const Image = (props) => require("react").createElement(View, props);
  Image.clearMemoryCache = jest.fn(async () => true);
  Image.clearDiskCache = jest.fn(async () => true);
  Image.prefetch = jest.fn(async () => true);
  Image.getCachePathAsync = jest.fn(async () => "/tmp/cache/img");
  return { Image };
});

// expo-video -> VideoView is a View; useVideoPlayer returns a stub player.
jest.mock("expo-video", () => {
  const { View } = require("react-native");
  return {
    VideoView: (props) => require("react").createElement(View, props),
    useVideoPlayer: () => ({
      play: jest.fn(),
      pause: jest.fn(),
      replace: jest.fn(),
      muted: false,
      loop: false,
    }),
  };
});

// expo-sharing -> available, share is a spy-able no-op.
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

// expo-media-library -> granted permission, save is a spy-able no-op.
jest.mock("expo-media-library", () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  saveToLibraryAsync: jest.fn(async () => {}),
}));

// react-native-mmkv (v4 Nitro: createMMKV factory) -> in-memory store so the
// emoji disk cache works in node.
jest.mock("react-native-mmkv", () => {
  const makeStore = () => {
    const m = new Map();
    return {
      set: (k, v) => m.set(k, v),
      getString: (k) => m.get(k),
      delete: (k) => m.delete(k),
      remove: (k) => m.delete(k),
    };
  };
  return { createMMKV: () => makeStore() };
});

// @expo/vector-icons -> render nothing (icons are decorative in assertions).
// Proxy so ANY icon family (Ionicons, MaterialCommunityIcons, …) resolves to a
// no-op component without enumerating them.
jest.mock("@expo/vector-icons", () => new Proxy({}, { get: () => () => null }));

// Native cookie manager (Reddit session jar) -> inert async stubs, so screens
// that import RedditCookies render in node without the native ESM module.
jest.mock("@preeternal/react-native-cookie-manager", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({})),
    set: jest.fn(async () => {}),
    clearAll: jest.fn(async () => {}),
  },
}));

// safe-area-context -> zero insets + passthrough provider (no native frame in node).
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }) => children,
  };
});

// expo-alternate-app-icons: native module absent in node — stub it.
jest.mock("expo-alternate-app-icons", () => ({
  supportsAlternateIcons: false,
  setAlternateAppIcon: jest.fn(async () => null),
  getAppIconName: jest.fn(() => null),
}));
