import {
  DEFAULT_SETTINGS,
  DEFAULT_SWIPE,
  coerceSettings,
  loadSettings,
  saveSettings,
  updateSettings,
} from "../settingsStore";

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

describe("coerceSettings", () => {
  it("returns defaults for an empty/garbage blob", () => {
    expect(coerceSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and rejects invalid enum values", () => {
    const s = coerceSettings({
      postLayout: "comfortable",
      appearance: "dark",
      defaultFeed: "all",
      topTimeWindow: "week",
      linkHandling: "browser",
      hideNsfw: true,
    });
    expect(s.postLayout).toBe("comfortable");
    expect(s.appearance).toBe("dark");
    expect(s.defaultFeed).toBe("all");
    expect(s.topTimeWindow).toBe("week");
    expect(s.linkHandling).toBe("browser");
    expect(s.hideNsfw).toBe(true);
  });

  it("falls back on unknown enum values", () => {
    const s = coerceSettings({
      postLayout: "ultra",
      appearance: "neon",
      defaultFeed: "everything",
    });
    expect(s.postLayout).toBe("compact");
    expect(s.appearance).toBe("system");
    expect(s.defaultFeed).toBe("subscribed");
  });

  it("clamps the font scale into range", () => {
    expect(coerceSettings({ fontScale: 99 }).fontScale).toBe(1.4);
    expect(coerceSettings({ fontScale: 0.1 }).fontScale).toBe(0.85);
    expect(coerceSettings({ fontScale: "big" }).fontScale).toBe(1);
  });

  it("coerces a partial / invalid swipe config to safe slots", () => {
    const s = coerceSettings({
      swipe: { rightShort: "save", rightLong: "explode", leftShort: 7 },
    });
    expect(s.swipe.rightShort).toBe("save");
    expect(s.swipe.rightLong).toBe(DEFAULT_SWIPE.rightLong); // "explode" rejected
    expect(s.swipe.leftShort).toBe(DEFAULT_SWIPE.leftShort); // 7 rejected
  });

  it("sanitises filter arrays to strings", () => {
    const s = coerceSettings({
      filters: { keywords: ["spam", 5, null, "ads"], mutedCommunities: "x" },
    });
    expect(s.filters.keywords).toEqual(["spam", "ads"]);
    expect(s.filters.mutedCommunities).toEqual([]);
  });
});

describe("persistence", () => {
  it("loads defaults when nothing is stored", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a saved value", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, hideNsfw: true });
    expect((await loadSettings()).hideNsfw).toBe(true);
  });

  it("merges a patch over the current settings", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, appearance: "dark" });
    const next = await updateSettings({ fontScale: 1.2 });
    expect(next.appearance).toBe("dark"); // preserved
    expect(next.fontScale).toBe(1.2); // patched
    expect((await loadSettings()).fontScale).toBe(1.2); // persisted
  });

  it("survives a corrupt stored blob", async () => {
    mockStore.set("janus.settings.v1", "{not json");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
