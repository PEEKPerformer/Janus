import { lemmyHome } from "../federation";

describe("lemmyHome", () => {
  it("returns the home host from a remote 'name@home' handle", () => {
    // Subscribed via hexbear.net, but the community lives on lemmy.world.
    expect(lemmyHome("technology@lemmy.world", "hexbear.net")).toBe(
      "lemmy.world",
    );
    expect(lemmyHome("asklemmy@lemmy.ml", "hexbear.net")).toBe("lemmy.ml");
  });

  it("falls back to the fetched instance for a local (bare-name) handle", () => {
    // A community local to the account's instance has no '@' — home == instance.
    expect(lemmyHome("chapotraphouse", "hexbear.net")).toBe("hexbear.net");
  });
});
