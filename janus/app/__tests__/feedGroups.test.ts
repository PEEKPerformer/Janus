import {
  parseCommunityAddress,
  addressLabel,
  loadGroups,
  saveGroup,
  removeGroup,
} from "../feedGroups";

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

describe("parseCommunityAddress", () => {
  it("parses Reddit forms", () => {
    expect(parseCommunityAddress("r/privacy")).toEqual({
      source: "reddit",
      name: "privacy",
    });
    expect(parseCommunityAddress("/r/aww")).toEqual({
      source: "reddit",
      name: "aww",
    });
    expect(parseCommunityAddress("https://www.reddit.com/r/linux")).toEqual({
      source: "reddit",
      name: "linux",
    });
  });

  it("parses Lemmy remote handle and URLs", () => {
    expect(parseCommunityAddress("privacy@lemmy.ml")).toEqual({
      source: "lemmy",
      instance: "lemmy.ml",
      name: "privacy",
    });
    expect(parseCommunityAddress("https://hexbear.net/c/technology")).toEqual({
      source: "lemmy",
      instance: "hexbear.net",
      name: "technology",
    });
    expect(parseCommunityAddress("https://lemmy.ml/c/privacy")).toEqual({
      source: "lemmy",
      instance: "lemmy.ml",
      name: "privacy",
    });
  });

  it("uses the default instance for a bare c/name", () => {
    expect(parseCommunityAddress("c/linux", "lemmy.ml")).toEqual({
      source: "lemmy",
      instance: "lemmy.ml",
      name: "linux",
    });
    // …but only if a default is supplied
    expect(parseCommunityAddress("c/linux")).toBeNull();
  });

  it("rejects ambiguous bare words and junk", () => {
    expect(parseCommunityAddress("privacy")).toBeNull();
    expect(parseCommunityAddress("")).toBeNull();
    expect(parseCommunityAddress("https://example.com/about")).toBeNull();
  });

  it("labels addresses for display", () => {
    expect(addressLabel({ source: "reddit", name: "privacy" })).toBe(
      "r/privacy",
    );
    expect(
      addressLabel({ source: "lemmy", instance: "lemmy.ml", name: "privacy" }),
    ).toBe("privacy@lemmy.ml");
  });
});

describe("group persistence", () => {
  const group = {
    id: "g1",
    name: "Privacy",
    members: [
      { source: "reddit" as const, name: "privacy" },
      { source: "lemmy" as const, instance: "lemmy.ml", name: "privacy" },
      { source: "lemmy" as const, instance: "hexbear.net", name: "technology" },
    ],
  };

  it("saves, loads, replaces by id, and removes", async () => {
    await saveGroup(group);
    let list = await loadGroups();
    expect(list).toHaveLength(1);
    expect(list[0].members).toHaveLength(3);

    await saveGroup({ ...group, name: "Privacy & Tech" }); // replace by id
    list = await loadGroups();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Privacy & Tech");

    list = await removeGroup("g1");
    expect(list).toHaveLength(0);
  });

  it("filters out corrupt stored groups", async () => {
    const SecureStore = require("expo-secure-store");
    await SecureStore.setItemAsync(
      "janus.feedGroups.v1",
      JSON.stringify([{ bogus: true }, group]),
    );
    const list = await loadGroups();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("g1");
  });
});
