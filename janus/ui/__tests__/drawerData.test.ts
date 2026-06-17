import {
  originKeyOf,
  buildOriginChips,
  filterByOrigin,
  sortCommunities,
  dedupeCommunities,
} from "../drawerData";
import type { Community } from "../../core/model";

function community(
  id: string,
  source: "reddit" | "lemmy",
  instance: string,
  name: string,
): Community {
  return { id, source, instance, name, handle: name } as unknown as Community;
}

const subs = [
  community("r1", "reddit", "www.reddit.com", "privacy"),
  community("r2", "reddit", "www.reddit.com", "linux"),
  community("h1", "lemmy", "hexbear.net", "technology"),
  community("m1", "lemmy", "lemmy.ml", "asklemmy"),
  community("m2", "lemmy", "lemmy.ml", "privacy"),
];

/** A federated community: fetched via one account's instance, but living on
 *  another — its home is in the "name@home" handle (Voyager's rule). */
function federated(
  id: string,
  fetchedFrom: string,
  name: string,
  home: string,
): Community {
  return {
    id,
    source: "lemmy",
    instance: fetchedFrom,
    name,
    handle: `${name}@${home}`,
  } as unknown as Community;
}

describe("originKeyOf", () => {
  it("keys reddit by source, local lemmy by instance", () => {
    expect(originKeyOf(subs[0])).toBe("reddit");
    expect(originKeyOf(subs[2])).toBe("hexbear.net");
  });

  it("keys a FEDERATED lemmy community by its home, not the fetching account", () => {
    // Subscribed via hexbear.net, but the community lives on lemmy.world —
    // the exact bug: it must badge as lemmy.world, never hexbear.net.
    const c = federated("x1", "hexbear.net", "technology", "lemmy.world");
    expect(originKeyOf(c)).toBe("lemmy.world");
  });
});

describe("origin grouping with a federated mix (all fetched via one account)", () => {
  // Everything fetched through the signed-in hexbear account, but a mix of
  // hexbear-local and federated communities.
  const mixed = [
    community("h1", "lemmy", "hexbear.net", "chapotraphouse"), // local handle
    federated("f1", "hexbear.net", "technology", "lemmy.world"),
    federated("f2", "hexbear.net", "asklemmy", "lemmy.ml"),
  ];
  it("chips separate the homes instead of collapsing to one account", () => {
    expect(buildOriginChips(mixed).map((c) => c.key)).toEqual([
      "all",
      "hexbear.net",
      "lemmy.ml",
      "lemmy.world",
    ]);
  });
  it("filtering by a federated home returns only that community", () => {
    expect(filterByOrigin(mixed, "lemmy.world").map((c) => c.id)).toEqual([
      "f1",
    ]);
  });
});

describe("buildOriginChips", () => {
  it("leads with All, then Reddit, then instances alphabetically", () => {
    const chips = buildOriginChips(subs);
    expect(chips.map((c) => c.key)).toEqual([
      "all",
      "reddit",
      "hexbear.net",
      "lemmy.ml",
    ]);
    expect(chips[0]).toEqual({ key: "all", label: "All", count: 5 });
    expect(chips.find((c) => c.key === "lemmy.ml")!.count).toBe(2);
  });

  it("only surfaces origins actually followed (no noise for single-instance users)", () => {
    const chips = buildOriginChips([subs[3], subs[4]]);
    expect(chips.map((c) => c.key)).toEqual(["all", "lemmy.ml"]);
  });
});

describe("filterByOrigin", () => {
  it("returns everything for 'all' and one origin otherwise", () => {
    expect(filterByOrigin(subs, "all")).toHaveLength(5);
    expect(filterByOrigin(subs, "reddit").map((c) => c.id)).toEqual([
      "r1",
      "r2",
    ]);
    expect(filterByOrigin(subs, "lemmy.ml").map((c) => c.id)).toEqual([
      "m1",
      "m2",
    ]);
  });
});

describe("sortCommunities", () => {
  it("merges sources into one alphabetised list", () => {
    expect(sortCommunities(subs).map((c) => c.name)).toEqual([
      "asklemmy",
      "linux",
      "privacy",
      "privacy",
      "technology",
    ]);
  });
});

describe("dedupeCommunities", () => {
  it("drops repeated ids", () => {
    expect(
      dedupeCommunities([subs[0], subs[0], subs[1]]).map((c) => c.id),
    ).toEqual(["r1", "r2"]);
  });
});
