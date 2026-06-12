import { tokenizeInline, parseBlocks } from "../components/Markdown";

describe("tokenizeInline", () => {
  it("returns a single text token for plain text", () => {
    expect(tokenizeInline("just words")).toEqual([
      { type: "text", content: "just words" },
    ]);
  });
  it("parses bold, italic, and code", () => {
    expect(tokenizeInline("**b**")).toEqual([{ type: "bold", content: "b" }]);
    expect(tokenizeInline("a *i* b")).toEqual([
      { type: "text", content: "a " },
      { type: "italic", content: "i" },
      { type: "text", content: " b" },
    ]);
    expect(tokenizeInline("`x`")).toEqual([{ type: "code", content: "x" }]);
  });
  it("parses Lemmy custom emoji as inline emoji tokens", () => {
    expect(
      tokenizeInline(
        '![phoenix-bashful](https://hexbear.net/pictrs/image/abc.png "emoji phoenix-bashful")',
      ),
    ).toEqual([
      {
        type: "emoji",
        content: "phoenix-bashful",
        url: "https://hexbear.net/pictrs/image/abc.png",
      },
    ]);
  });
  it("parses a non-emoji image (no emoji title) as an image token", () => {
    expect(
      tokenizeInline("![](https://hexbear.net/pictrs/image/x.jpeg)"),
    ).toEqual([
      {
        type: "image",
        content: "",
        url: "https://hexbear.net/pictrs/image/x.jpeg",
      },
    ]);
  });
  it("renders emoji inline amid surrounding text", () => {
    expect(tokenizeInline('hi ![w](https://e/w.png "emoji w") there')).toEqual([
      { type: "text", content: "hi " },
      { type: "emoji", content: "w", url: "https://e/w.png" },
      { type: "text", content: " there" },
    ]);
  });
  it("parses explicit and bare links", () => {
    expect(tokenizeInline("[lbl](https://e.com)")).toEqual([
      { type: "link", content: "lbl", url: "https://e.com" },
    ]);
    expect(tokenizeInline("see https://z.com end")).toEqual([
      { type: "text", content: "see " },
      { type: "link", content: "https://z.com", url: "https://z.com" },
      { type: "text", content: " end" },
    ]);
  });
});

describe("parseBlocks", () => {
  it("splits headings, quotes, lists, code, hr, paragraphs", () => {
    const md = [
      "# Title",
      "",
      "A paragraph line one",
      "line two",
      "",
      "> a quote",
      "",
      "- one",
      "- two",
      "",
      "```",
      "code();",
      "```",
      "",
      "---",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Title" });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      text: "A paragraph line one line two",
    });
    expect(blocks[2]).toEqual({ type: "quote", text: "a quote" });
    expect(blocks[3]).toEqual({
      type: "list",
      items: ["one", "two"],
      ordered: false,
    });
    expect(blocks[4]).toEqual({ type: "code", text: "code();" });
    expect(blocks[5]).toEqual({ type: "hr" });
  });

  it("detects ordered lists", () => {
    const blocks = parseBlocks("1. first\n2. second");
    expect(blocks[0]).toEqual({
      type: "list",
      items: ["first", "second"],
      ordered: true,
    });
  });

  it("parses a GFM pipe table with alignment", () => {
    const md = [
      "| Card | AF | Notes |",
      "|:-----|---:|:-----:|",
      "| CSP | $95 | keep |",
      "| Gold | $250 | downgrade |",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(blocks[0]).toEqual({
      type: "table",
      header: ["Card", "AF", "Notes"],
      align: ["left", "right", "center"],
      rows: [
        ["CSP", "$95", "keep"],
        ["Gold", "$250", "downgrade"],
      ],
    });
  });

  it("does not treat a lone --- as a table", () => {
    expect(parseBlocks("a | b\n---").map((b) => b.type)).not.toContain("table");
  });
});

describe("tokenizeInline — strikethrough, spoiler, superscript", () => {
  it("parses ~~strikethrough~~", () => {
    expect(tokenizeInline("~~gone~~")).toEqual([
      { type: "strike", content: "gone" },
    ]);
  });

  it("parses a Reddit >!spoiler!<", () => {
    expect(tokenizeInline("the answer is >!42!< ok")).toEqual([
      { type: "text", content: "the answer is " },
      { type: "spoiler", content: "42" },
      { type: "text", content: " ok" },
    ]);
  });

  it("parses superscript ^(text) and ^word", () => {
    expect(tokenizeInline("E=mc^2")).toEqual([
      { type: "text", content: "E=mc" },
      { type: "superscript", content: "2" },
    ]);
    expect(tokenizeInline("^(small print)")).toEqual([
      { type: "superscript", content: "small print" },
    ]);
  });
});
