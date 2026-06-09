import { findThreadMatches, isNewComment } from "../threadSearch";
import type { VisibleComment } from "../../core/comment-tree";

const row = (
  id: string,
  body: string,
  handle: string,
  loadMore = false,
): VisibleComment =>
  ({
    comment: {
      id,
      body: { text: body },
      author: { handle, username: handle },
      createdAt: 0,
    },
    depth: 0,
    collapsed: false,
    descendantCount: 0,
    hasChildren: false,
    loadMore: loadMore ? { kind: "more" } : undefined,
  }) as unknown as VisibleComment;

describe("findThreadMatches", () => {
  const visible = [
    row("1", "The quick brown fox", "u/alpha"),
    row("2", "jumps over", "beta@lemmy.world"),
    row("3", "the lazy dog", "u/gamma"),
    row("4", "more to load", "u/alpha", true),
    row("5", "FOX again", "u/delta"),
  ];

  it("matches body text case-insensitively, in order", () => {
    expect(findThreadMatches(visible, "fox")).toEqual([0, 4]);
  });

  it("matches author handles on both networks", () => {
    expect(findThreadMatches(visible, "alpha")).toEqual([0]);
    expect(findThreadMatches(visible, "lemmy.world")).toEqual([1]);
  });

  it("requires 2+ characters and skips load-more rows", () => {
    expect(findThreadMatches(visible, "f")).toEqual([]);
    expect(findThreadMatches(visible, "  ")).toEqual([]);
    // "load" appears only in the loadMore row, which never matches.
    expect(findThreadMatches(visible, "more to load")).toEqual([]);
  });
});

describe("isNewComment", () => {
  const c = (createdAt: number, username = "someone") => ({
    createdAt,
    author: { username },
  });

  it("false on a first visit (no baseline)", () => {
    expect(isNewComment(c(100), null, null)).toBe(false);
  });

  it("true only for comments after the previous visit", () => {
    expect(isNewComment(c(50), 100, null)).toBe(false);
    expect(isNewComment(c(100), 100, null)).toBe(false);
    expect(isNewComment(c(101), 100, null)).toBe(true);
  });

  it("never marks your own fresh replies", () => {
    expect(isNewComment(c(200, "me"), 100, "me")).toBe(false);
    expect(isNewComment(c(200, "other"), 100, "me")).toBe(true);
  });
});
