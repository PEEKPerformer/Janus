import { RedditAdapter } from "../reddit-adapter";
import type { RedditTransport } from "../transport";
import type { AccountRef } from "../../../core/adapter";
import { rid } from "../mappers/shared";

function captureAdapter(account?: AccountRef) {
  const calls: { url: string; method?: string; body?: unknown }[] = [];
  const transport = {
    request: async (
      url: string,
      opts?: { method?: string; body?: unknown },
    ) => {
      calls.push({ url, method: opts?.method, body: opts?.body });
      return {};
    },
  } as unknown as RedditTransport;
  return { adapter: new RedditAdapter({ transport, account }), calls };
}

const alice: AccountRef = {
  id: rid("user", "alice"),
  source: "reddit",
  instance: "www.reddit.com",
  username: "alice",
  isGuest: false,
};

describe("RedditAdapter multireddit CRUD", () => {
  it("creates a multireddit under the user's path with a slug", async () => {
    const { adapter, calls } = captureAdapter(alice);
    const multi = await adapter.createMultireddit("My News!");
    expect(calls[0].url).toContain("/api/multi/user/alice/m/my_news");
    expect(calls[0].method).toBe("POST");
    expect(multi.name).toBe("My News!");
    expect(multi.communities).toEqual([]);
  });

  it("adds a community via PUT .../r/{sub}", async () => {
    const { adapter, calls } = captureAdapter(alice);
    await adapter.addToMultireddit(
      rid("multireddit", "user/alice/m/news"),
      rid("community", "worldnews"),
    );
    expect(calls[0].url).toContain("/api/multi/user/alice/m/news/r/worldnews");
    expect(calls[0].method).toBe("PUT");
  });

  it("removes a community via DELETE .../r/{sub}", async () => {
    const { adapter, calls } = captureAdapter(alice);
    await adapter.removeFromMultireddit(
      rid("multireddit", "user/alice/m/news"),
      rid("community", "worldnews"),
    );
    expect(calls[0].url).toContain("/api/multi/user/alice/m/news/r/worldnews");
    expect(calls[0].method).toBe("DELETE");
  });

  it("deletes the whole multireddit", async () => {
    const { adapter, calls } = captureAdapter(alice);
    await adapter.deleteMultireddit(rid("multireddit", "user/alice/m/news"));
    expect(calls[0].url).toContain("/api/multi/user/alice/m/news");
    expect(calls[0].method).toBe("DELETE");
  });
});
