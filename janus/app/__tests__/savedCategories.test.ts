/**
 * Saved categories — the RES-style overlay on both networks' saved lists.
 */
import {
  initSavedCategories,
  getCategory,
  setCategory,
  listCategories,
  flushSavedCategories,
  __resetSavedCategories,
} from "../savedCategories";

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

beforeEach(() => {
  mockStore.clear();
  __resetSavedCategories();
});

describe("savedCategories", () => {
  it("files items from both networks and lists distinct categories sorted", async () => {
    await initSavedCategories();
    setCategory("reddit:www.reddit.com:post:a", "Churning datapoints");
    setCategory("lemmy:lemmy.world:post:9", "Recipes");
    setCategory("reddit:www.reddit.com:comment:c", "Churning datapoints");
    expect(getCategory("lemmy:lemmy.world:post:9")).toBe("Recipes");
    expect(listCategories()).toEqual(["Churning datapoints", "Recipes"]);
  });

  it("null/blank clears an assignment; persists across reload", async () => {
    await initSavedCategories();
    setCategory("p1", "Keep");
    setCategory("p2", "Drop");
    setCategory("p2", null);
    setCategory("p3", "   ");
    await flushSavedCategories();
    __resetSavedCategories();
    await initSavedCategories();
    expect(getCategory("p1")).toBe("Keep");
    expect(getCategory("p2")).toBeUndefined();
    expect(getCategory("p3")).toBeUndefined();
    expect(listCategories()).toEqual(["Keep"]);
  });

  it("clamps names and bounds the store", async () => {
    await initSavedCategories();
    setCategory("long", "x".repeat(80));
    expect(getCategory("long")).toHaveLength(40);
    for (let i = 0; i < 2010; i++) setCategory(`id${i}`, "bucket");
    expect(getCategory("id0")).toBeUndefined();
    expect(getCategory("id2009")).toBe("bucket");
  });
});
