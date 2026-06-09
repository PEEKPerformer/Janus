import {
  curatedTwinsFor,
  splitLemmyHandle,
  suggestTwinSearch,
  isAcceptableSuggestion,
} from "../communityTwins";

describe("splitLemmyHandle", () => {
  it("splits name@instance and bare names, normalizing", () => {
    expect(splitLemmyHandle("technology@lemmy.world")).toEqual({
      name: "technology",
      instance: "lemmy.world",
    });
    expect(splitLemmyHandle("Linux")).toEqual({
      name: "linux",
      instance: undefined,
    });
  });
});

describe("curatedTwinsFor", () => {
  it("maps a subreddit to its Lemmy twin(s)", () => {
    const twins = curatedTwinsFor({ source: "reddit", name: "technology" });
    expect(twins).toEqual([
      {
        source: "lemmy",
        handle: "technology@lemmy.world",
        name: "technology",
        instance: "lemmy.world",
        verified: true,
      },
    ]);
  });

  it("tolerates an r/ prefix and casing", () => {
    expect(curatedTwinsFor({ source: "reddit", name: "r/Linux" })).toHaveLength(
      1,
    );
  });

  it("maps a name-mismatched topic twin (AskReddit → asklemmy)", () => {
    const twins = curatedTwinsFor({ source: "reddit", name: "askreddit" });
    expect(twins[0].handle).toBe("asklemmy@lemmy.ml");
  });

  it("maps a Lemmy community back to its subreddit by local part", () => {
    const twins = curatedTwinsFor({
      source: "lemmy",
      name: "asklemmy@lemmy.ml",
    });
    expect(twins).toEqual([
      {
        source: "reddit",
        handle: "r/askreddit",
        name: "askreddit",
        verified: true,
      },
    ]);
  });

  it("returns [] for unknown communities", () => {
    expect(
      curatedTwinsFor({ source: "reddit", name: "some_random_sub" }),
    ).toEqual([]);
  });

  it("can return multiple Lemmy twins, best first", () => {
    const twins = curatedTwinsFor({ source: "reddit", name: "android" });
    expect(twins.map((tw) => tw.handle)).toEqual([
      "android@lemdro.id",
      "android@lemmy.world",
    ]);
  });
});

describe("suggested tier policy", () => {
  it("targets the other network with the bare name", () => {
    expect(
      suggestTwinSearch({ source: "reddit", name: "r/woodworking" }),
    ).toEqual({ otherSource: "lemmy", query: "woodworking" });
  });

  it("accepts only same-name, active-enough candidates", () => {
    expect(
      isAcceptableSuggestion(
        { name: "woodworking", subscriberCount: 1200 },
        "woodworking",
      ),
    ).toBe(true);
    expect(
      isAcceptableSuggestion(
        { name: "woodworking", subscriberCount: 12 },
        "woodworking",
      ),
    ).toBe(false);
    expect(
      isAcceptableSuggestion(
        { name: "woodworkers", subscriberCount: 9000 },
        "woodworking",
      ),
    ).toBe(false);
  });
});
