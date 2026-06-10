import { topFlairs, filterByFlair } from "../flairFilter";
import type { Post } from "../../core/model";

const p = (id: string, flairText?: string): Post =>
  ({ id, flair: flairText ? { text: flairText } : undefined }) as Post;

describe("flair browsing", () => {
  const posts = [
    p("1", "Discussion"),
    p("2", "News"),
    p("3", "Discussion"),
    p("4"), // Lemmy-shaped: no flair
    p("5", "  Discussion  "), // whitespace normalizes
    p("6", "Help"),
  ];

  it("ranks flairs by frequency, then alphabetically", () => {
    expect(topFlairs(posts)).toEqual([
      { text: "Discussion", count: 3 },
      { text: "Help", count: 1 },
      { text: "News", count: 1 },
    ]);
  });

  it("caps the chip count", () => {
    const many = Array.from({ length: 20 }, (_, i) => p(`x${i}`, `F${i}`));
    expect(topFlairs(many, 5)).toHaveLength(5);
  });

  it("yields no chips for flairless (Lemmy) feeds — honest gating", () => {
    expect(topFlairs([p("a"), p("b")])).toEqual([]);
  });

  it("filters by the active flair; null passes everything through", () => {
    expect(filterByFlair(posts, "Discussion").map((x) => x.id)).toEqual([
      "1",
      "3",
      "5",
    ]);
    expect(filterByFlair(posts, null)).toHaveLength(6);
  });
});
