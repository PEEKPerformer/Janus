import { postShareUrl, hostname, isHttpUrl } from "../links";
import { mapLemmyPost } from "../../sources/lemmy/mappers";
import { lemmyListFixture } from "../../sources/lemmy/__fixtures__/lemmySamples";
import { mapPost } from "../../sources/reddit/mappers/post";
import { listingFixture } from "../../sources/reddit/__fixtures__/redditSamples";

describe("isHttpUrl / hostname", () => {
  it("validates http(s) urls and extracts the host", () => {
    expect(isHttpUrl("https://example.com/x")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(hostname("https://www.reddit.com/r/aww")).toBe("reddit.com");
  });
});

describe("postShareUrl", () => {
  it("builds a reddit permalink URL", () => {
    const redditPost = mapPost(listingFixture.data.children[0]);
    const url = postShareUrl(redditPost);
    expect(url.startsWith("https://www.reddit.com/")).toBe(true);
  });

  it("uses the Lemmy ap_id as the canonical share URL", () => {
    const lemmyPost = mapLemmyPost(lemmyListFixture.posts[0], "lemmy.world");
    const apId = lemmyPost.ext.source === "lemmy" ? lemmyPost.ext.apId : "";
    expect(postShareUrl(lemmyPost)).toBe(apId);
  });
});
