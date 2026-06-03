import React from "react";
import { Text, Pressable } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SettingsProvider, useSettings } from "../SettingsContext";
import { DEFAULT_SETTINGS } from "../../app/settingsStore";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

beforeEach(() => mockStore.clear());

function Probe() {
  const { settings, set } = useSettings();
  return (
    <>
      <Text testID="layout">{settings.postLayout}</Text>
      <Pressable
        accessibilityLabel="go-comfortable"
        onPress={() => set({ postLayout: "comfortable" })}
      >
        <Text>set</Text>
      </Pressable>
    </>
  );
}

describe("SettingsProvider", () => {
  it("provides the initial settings and applies a patch optimistically", () => {
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("layout").props.children).toBe("compact");
    fireEvent.press(screen.getByLabelText("go-comfortable"));
    expect(screen.getByTestId("layout").props.children).toBe("comfortable");
  });

  it("persists patches through to the store", async () => {
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>,
    );
    fireEvent.press(screen.getByLabelText("go-comfortable"));
    await waitFor(() => {
      const raw = mockStore.get("janus.settings.v1");
      expect(raw && JSON.parse(raw).postLayout).toBe("comfortable");
    });
  });
});

describe("useSettings outside a provider", () => {
  it("returns defaults with a no-op setter", () => {
    render(<Probe />);
    expect(screen.getByTestId("layout").props.children).toBe("compact");
    // set() is a no-op here; pressing must not throw.
    fireEvent.press(screen.getByLabelText("go-comfortable"));
    expect(screen.getByTestId("layout").props.children).toBe("compact");
  });
});
