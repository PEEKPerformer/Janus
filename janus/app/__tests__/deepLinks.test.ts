import { parseShareUrl } from "../deepLinks";

describe("parseShareUrl — Reddit", () => {
  it("parses a subreddit URL", () => {
    expect(parseShareUrl("https://www.reddit.com/r/privacy")).toEqual({
      kind: "community",
      source: "reddit",
      name: "privacy",
    });
  });

  it("parses a post URL with community", () => {
    expect(
      parseShareUrl("https://reddit.com/r/aww/comments/abc123/a_cute_cat/"),
    ).toEqual({
      kind: "post",
      source: "reddit",
      postId: "abc123",
      community: "aww",
    });
  });

  it("parses a user URL (u/ and user/)", () => {
    expect(parseShareUrl("https://old.reddit.com/u/spez")).toEqual({
      kind: "user",
      source: "reddit",
      name: "spez",
    });
    expect(parseShareUrl("https://www.reddit.com/user/spez")).toMatchObject({
      kind: "user",
      name: "spez",
    });
  });
});

describe("parseShareUrl — Lemmy", () => {
  it("parses a local community URL", () => {
    expect(parseShareUrl("https://lemmy.world/c/technology")).toEqual({
      kind: "community",
      source: "lemmy",
      instance: "lemmy.world",
      name: "technology",
      handle: "technology",
    });
  });

  it("parses a qualified (remote) community URL", () => {
    expect(parseShareUrl("https://lemmy.world/c/asklemmy@lemmy.ml")).toEqual({
      kind: "community",
      source: "lemmy",
      instance: "lemmy.ml",
      name: "asklemmy",
      handle: "asklemmy@lemmy.ml",
    });
  });

  it("parses a post URL", () => {
    expect(parseShareUrl("https://hexbear.net/post/98765")).toEqual({
      kind: "post",
      source: "lemmy",
      instance: "hexbear.net",
      postId: "98765",
    });
  });
});

describe("parseShareUrl — junk", () => {
  it("returns null for non-URLs and unknown paths", () => {
    expect(parseShareUrl("not a url")).toBeNull();
    expect(parseShareUrl("https://reddit.com/")).toBeNull();
    expect(parseShareUrl("https://example.com/about")).toBeNull();
  });
});
