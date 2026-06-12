import { userColor } from "../userColors";

describe("userColor", () => {
  it("is deterministic — same user, same color, every render", () => {
    expect(userColor("alice", "dark")).toBe(userColor("alice", "dark"));
    expect(userColor("alice", "light")).toBe(userColor("alice", "light"));
  });

  it("is case-insensitive (Reddit names are unique case-insensitively)", () => {
    expect(userColor("GallowBoob", "dark")).toBe(
      userColor("gallowboob", "dark"),
    );
  });

  it("varies only the hue, with scheme-appropriate lightness", () => {
    expect(userColor("alice", "dark")).toMatch(/^hsl\(\d{1,3}, 60%, 72%\)$/);
    expect(userColor("alice", "light")).toMatch(/^hsl\(\d{1,3}, 70%, 34%\)$/);
  });

  it("spreads typical usernames across distinct hues", () => {
    const users = ["alice", "bob", "carol", "dave", "erin", "frank"];
    const hues = users.map((u) =>
      Number(/hsl\((\d+),/.exec(userColor(u, "dark"))![1]),
    );
    expect(new Set(hues).size).toBe(users.length);
  });
});
