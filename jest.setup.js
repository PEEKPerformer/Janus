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
  // Track every store so tests can be isolated (see jest.afterEach.js) — a
  // module-level SwrCache would otherwise leak entries across test cases.
  const stores = (globalThis.__mmkvStores = globalThis.__mmkvStores || []);
  const makeStore = () => {
    const m = new Map();
    stores.push(m);
    return {
      set: (k, v) => m.set(k, v),
      getString: (k) => m.get(k),
      delete: (k) => m.delete(k),
      remove: (k) => m.delete(k),
    };
  };
  return { createMMKV: () => makeStore() };
});

// NetInfo (plane-mode offline detection) -> connected; tests flip state via
// the offline store's __setOffline instead of simulating NetInfo events.
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => {}),
    fetch: jest.fn(async () => ({ isConnected: true })),
  },
}));

// expo-keep-awake (held during plane-mode packing) -> inert async stubs.
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));

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

// expo-secure-store -> in-memory map (HF token for AI Lens, emoji prefs).
jest.mock("expo-secure-store", () => {
  const m = new Map();
  return {
    getItemAsync: jest.fn(async (k) => m.get(k) ?? null),
    setItemAsync: jest.fn(async (k, v) => void m.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void m.delete(k)),
  };
});

// expo-file-system (AI Lens model storage) -> inert stubs; modules that do
// real IO take a PangramFs dependency and are tested with in-memory fakes.
jest.mock("expo-file-system", () => {
  class FileHandle {
    offset = 0;
    readBytes() {
      return new Uint8Array(0);
    }
    writeBytes() {}
    close() {}
  }
  class File {
    exists = false;
    uri = "file:///tmp/janus-test";
    size = 0;
    create() {}
    delete() {}
    open() {
      return new FileHandle();
    }
    text() {
      return "";
    }
  }
  class Directory {
    exists = false;
    create() {}
    delete() {}
  }
  return { File, Directory, Paths: { document: "/tmp/janus-test" } };
});
jest.mock("expo-file-system/legacy", () => ({
  copyAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: jest.fn(async () => ({ status: 200 })),
  })),
}));

// onnxruntime-react-native: native runtime absent in node — sessions reject,
// so aiLens code paths exercise their "engine unavailable" handling.
jest.mock("onnxruntime-react-native", () => ({
  InferenceSession: {
    create: jest.fn(async () => {
      throw new Error("onnxruntime native module not available in tests");
    }),
  },
  Tensor: function Tensor() {},
}));

// expo-alternate-app-icons: native module absent in node — stub it.
jest.mock("expo-alternate-app-icons", () => ({
  supportsAlternateIcons: false,
  setAlternateAppIcon: jest.fn(async () => null),
  getAppIconName: jest.fn(() => null),
}));
