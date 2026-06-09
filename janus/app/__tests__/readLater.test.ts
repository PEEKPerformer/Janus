/**
 * Read Later — the local, account-free queue. Cross-network: exercised with
 * Reddit and Lemmy shaped ids, since it must behave identically for both.
 */
import {
  initReadLater,
  isReadLater,
  addReadLater,
  removeReadLater,
  toggleReadLater,
  listReadLater,
  readLaterCount,
  clearReadLater,
  flushReadLater,
  __resetReadLater,
  type QueueablePost,
} from "../readLater";

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
  __resetReadLater();
});

const redditPost: QueueablePost = {
  id: "reddit:www.reddit.com:post:abc",
  title: "A reddit post",
  community: { handle: "r/test" },
  source: "reddit",
  commentCount: 12,
};
const lemmyPost: QueueablePost = {
  id: "lemmy:hexbear.net:post:9",
  title: "A lemmy post",
  community: { handle: "chat@hexbear.net" },
  source: "lemmy",
  commentCount: 3,
};

describe("readLater", () => {
  it("queues posts from both networks, newest first", async () => {
    await initReadLater();
    addReadLater(redditPost, 1000);
    addReadLater(lemmyPost, 2000);
    expect(isReadLater(redditPost.id)).toBe(true);
    expect(isReadLater(lemmyPost.id)).toBe(true);
    expect(listReadLater().map((e) => e.id)).toEqual([
      lemmyPost.id,
      redditPost.id,
    ]);
    expect(readLaterCount()).toBe(2);
  });

  it("toggle adds then removes", async () => {
    await initReadLater();
    expect(toggleReadLater(redditPost, 1000)).toBe(true);
    expect(isReadLater(redditPost.id)).toBe(true);
    expect(toggleReadLater(redditPost, 2000)).toBe(false);
    expect(isReadLater(redditPost.id)).toBe(false);
  });

  it("persists across a reload; remove and clear work", async () => {
    await initReadLater();
    addReadLater(redditPost, 1000);
    addReadLater(lemmyPost, 2000);
    removeReadLater(lemmyPost.id);
    await flushReadLater();
    __resetReadLater();
    await initReadLater();
    expect(listReadLater().map((e) => e.id)).toEqual([redditPost.id]);
    clearReadLater();
    expect(readLaterCount()).toBe(0);
  });

  it("bounds the queue, evicting the oldest", async () => {
    await initReadLater();
    for (let i = 0; i < 310; i++) {
      addReadLater({ ...redditPost, id: `reddit:r:post:${i}` }, i + 1);
    }
    expect(isReadLater("reddit:r:post:0")).toBe(false);
    expect(isReadLater("reddit:r:post:309")).toBe(true);
    expect(readLaterCount()).toBeLessThanOrEqual(300);
  });
});
