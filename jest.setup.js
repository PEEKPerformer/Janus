/* Jest setup: mock the few native-only UI deps so the component tree renders in
 * node. Domain/adapter logic is already covered without these. */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name */

// FlashList -> a plain View that renders header, items (or empty), footer.
jest.mock("@shopify/flash-list", () => {
  const React = require("react");
  const { View } = require("react-native");
  const resolve = (C) => (typeof C === "function" ? React.createElement(C) : C ?? null);
  const FlashList = ({ data = [], renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent }) =>
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

// expo-image -> a View (we only assert structure/labels, not pixels).
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});

// @expo/vector-icons -> render nothing (icons are decorative in assertions).
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
