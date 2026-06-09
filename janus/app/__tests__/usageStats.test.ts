import { loadUsageStats, bumpUsage, resetUsageStats } from "../usageStats";

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

describe("usageStats", () => {
  it("starts empty", async () => {
    const s = await loadUsageStats();
    expect(s.postsOpened).toBe(0);
    expect(s.votesCast).toBe(0);
    expect(s.since).toBe(0);
  });

  it("accumulates counters and stamps `since` once", async () => {
    await bumpUsage("postsOpened", 1000);
    await bumpUsage("postsOpened", 2000);
    await bumpUsage("votesCast", 3000);
    const s = await loadUsageStats();
    expect(s.postsOpened).toBe(2);
    expect(s.votesCast).toBe(1);
    expect(s.since).toBe(1000); // first action wins
  });

  it("resets to empty", async () => {
    await bumpUsage("commentsPosted", 1);
    await resetUsageStats();
    expect((await loadUsageStats()).commentsPosted).toBe(0);
  });
});
