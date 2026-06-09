import { RedditAdapter } from "../reddit-adapter";
import type { RedditTransport } from "../transport";
import { rid } from "../mappers/shared";

function searchAdapter() {
  const urls: string[] = [];
  const transport = {
    request: async (url: string) => {
      urls.push(url);
      return { data: { children: [], after: null } };
    },
  } as unknown as RedditTransport;
  return { adapter: new RedditAdapter({ transport }), urls };
}

describe("RedditAdapter.search posts", () => {
  it("global post search hits /search with sort + time window", async () => {
    const { adapter, urls } = searchAdapter();
    await adapter.search("cats", "posts", { sort: "top", timeWindow: "week" });
    expect(urls[0]).toContain("/search");
    expect(urls[0]).not.toContain("restrict_sr");
    expect(urls[0]).toContain("sort=top");
    expect(urls[0]).toContain("t=week");
  });

  it("in-community search restricts to the subreddit", async () => {
    const { adapter, urls } = searchAdapter();
    await adapter.search("cats", "posts", {
      sort: "new",
      communityId: rid("community", "aww"),
    });
    expect(urls[0]).toContain("/r/aww/search");
    expect(urls[0]).toContain("restrict_sr=on");
  });
});
