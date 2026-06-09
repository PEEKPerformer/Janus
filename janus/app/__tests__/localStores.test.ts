import { getCommunitySort, setCommunitySort } from "../communityPrefs";
import {
  getPostDraft,
  savePostDraft,
  clearPostDraft,
  getCommentDraft,
  saveCommentDraft,
} from "../drafts";
import {
  initSeenPosts,
  isSeen,
  markSeen,
  flushSeen,
  __resetSeenPosts,
} from "../seenPosts";

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
  __resetSeenPosts();
});

describe("communityPrefs", () => {
  it("remembers post and comment sort independently per community", async () => {
    await setCommunitySort("c1", "post", "top");
    await setCommunitySort("c1", "comment", "new");
    await setCommunitySort("c2", "post", "hot");
    expect(await getCommunitySort("c1", "post")).toBe("top");
    expect(await getCommunitySort("c1", "comment")).toBe("new");
    expect(await getCommunitySort("c2", "post")).toBe("hot");
    expect(await getCommunitySort("c2", "comment")).toBeUndefined();
  });

  it("overwrites a prior sort for the same community", async () => {
    await setCommunitySort("c1", "post", "top");
    await setCommunitySort("c1", "post", "new");
    expect(await getCommunitySort("c1", "post")).toBe("new");
  });
});

describe("drafts", () => {
  it("saves and restores a post draft, and clears it", async () => {
    await savePostDraft({
      communityId: "c1",
      title: "Hi",
      body: "body",
      ts: 1,
    });
    expect(await getPostDraft()).toMatchObject({ title: "Hi", body: "body" });
    await clearPostDraft();
    expect(await getPostDraft()).toBeUndefined();
  });

  it("treats an all-whitespace draft as no draft", async () => {
    await savePostDraft({ title: "   ", body: "\n", ts: 1 });
    expect(await getPostDraft()).toBeUndefined();
  });

  it("keys comment drafts by target and clears on empty", async () => {
    await saveCommentDraft("t1", "reply");
    await saveCommentDraft("t2", "other");
    expect(await getCommentDraft("t1")).toBe("reply");
    await saveCommentDraft("t1", "");
    expect(await getCommentDraft("t1")).toBeUndefined();
    expect(await getCommentDraft("t2")).toBe("other");
  });
});

describe("seenPosts", () => {
  it("marks and reports seen ids synchronously after init", async () => {
    await initSeenPosts();
    expect(isSeen("p1")).toBe(false);
    markSeen("p1");
    expect(isSeen("p1")).toBe(true);
  });

  it("persists and reloads the seen set", async () => {
    await initSeenPosts();
    markSeen("p1");
    markSeen("p2");
    await flushSeen();
    __resetSeenPosts();
    await initSeenPosts();
    expect(isSeen("p1")).toBe(true);
    expect(isSeen("p2")).toBe(true);
  });
});
