import { RedditAdapter } from "../reddit-adapter";
import type { RedditTransport } from "../transport";
import { rid } from "../mappers/shared";
import { NotFoundError } from "../../../core/errors";

/** A RedditAdapter wired to a stub transport that matches request URLs to canned JSON. */
function stubAdapter(routes: [string, unknown][]) {
  const urls: string[] = [];
  const transport = {
    request: async (url: string) => {
      urls.push(url);
      for (const [frag, res] of routes) {
        if (url.includes(frag)) return res;
      }
      throw new NotFoundError(`unexpected url ${url}`);
    },
  } as unknown as RedditTransport;
  return { adapter: new RedditAdapter({ transport }), urls };
}

describe("RedditAdapter community rules", () => {
  it("advertises rules + wiki capabilities", () => {
    const { adapter } = stubAdapter([]);
    expect(adapter.capabilities.supportsRules).toBe(true);
    expect(adapter.capabilities.supportsWiki).toBe(true);
  });

  it("maps /about/rules into CommunityRule[]", async () => {
    const { adapter, urls } = stubAdapter([
      [
        "/about/rules",
        {
          rules: [
            {
              short_name: "Be civil",
              description: "No personal attacks.",
              description_html: "<p>No personal attacks.</p>",
            },
            { short_name: "Stay on topic" },
          ],
        },
      ],
    ]);
    const rules = await adapter.getCommunityRules(rid("community", "privacy"));
    expect(urls[0]).toContain("/r/privacy/about/rules");
    expect(rules).toHaveLength(2);
    expect(rules[0].name).toBe("Be civil");
    expect(rules[0].description?.markdown).toBe("No personal attacks.");
    expect(rules[1].name).toBe("Stay on topic");
    expect(rules[1].description?.markdown).toBeUndefined();
  });

  it("tolerates a missing rules array", async () => {
    const { adapter } = stubAdapter([["/about/rules", {}]]);
    expect(await adapter.getCommunityRules(rid("community", "x"))).toEqual([]);
  });
});

describe("RedditAdapter post flairs", () => {
  it("maps link_flair_v2, dropping mod-only and empty flairs", async () => {
    const { adapter, urls } = stubAdapter([
      [
        "/api/link_flair_v2",
        [
          {
            id: "f1",
            text: "Discussion",
            background_color: "#349e48",
            text_color: "light",
            mod_only: false,
          },
          { id: "f2", text: "Announcement", mod_only: true },
          { id: "f3", text: "" },
        ],
      ],
    ]);
    const flairs = await adapter.getPostFlairs(rid("community", "privacy"));
    expect(urls[0]).toContain("/r/privacy/api/link_flair_v2");
    expect(flairs).toHaveLength(1);
    expect(flairs[0]).toEqual({
      id: "f1",
      text: "Discussion",
      backgroundColor: "#349e48",
      textColor: "#fff",
    });
  });

  it("returns [] when flair fetch fails (403 / disabled)", async () => {
    const { adapter } = stubAdapter([]); // any url throws NotFound
    expect(await adapter.getPostFlairs(rid("community", "x"))).toEqual([]);
  });
});

describe("RedditAdapter wiki", () => {
  it("maps a wiki page (markdown + revision metadata)", async () => {
    const { adapter, urls } = stubAdapter([
      [
        "/wiki/index",
        {
          kind: "wikipage",
          data: {
            content_md: "# Welcome",
            content_html: "<h1>Welcome</h1>",
            revision_date: 1_700_000_000, // epoch SECONDS
            revision_by: { kind: "t2", data: { name: "mod_alice" } },
          },
        },
      ],
    ]);
    const page = await adapter.getWikiPage(rid("community", "privacy"));
    expect(urls[0]).toContain("/r/privacy/wiki/index");
    expect(page.path).toBe("index");
    expect(page.content.markdown).toBe("# Welcome");
    expect(page.revisedAt).toBe(1_700_000_000 * 1000);
    expect(page.revisedBy).toBe("mod_alice");
  });

  it("fetches a named sub-page slug", async () => {
    const { adapter, urls } = stubAdapter([
      ["/wiki/config/sidebar", { kind: "wikipage", data: { content_md: "x" } }],
    ]);
    const page = await adapter.getWikiPage(
      rid("community", "privacy"),
      "config/sidebar",
    );
    expect(urls[0]).toContain("/r/privacy/wiki/config/sidebar");
    expect(page.path).toBe("config/sidebar");
  });

  it("throws NotFound when the response isn't a wiki page", async () => {
    const { adapter } = stubAdapter([
      ["/wiki/index", { kind: "Listing", data: {} }],
    ]);
    await expect(
      adapter.getWikiPage(rid("community", "privacy")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
