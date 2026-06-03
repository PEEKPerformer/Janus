import { applyFormat } from "../markdownEditor";

const sel = (start: number, end: number) => ({ start, end });

describe("applyFormat — inline wraps", () => {
  it("bolds the selection and keeps the inner text selected", () => {
    const r = applyFormat("bold", "hello world", sel(6, 11));
    expect(r.text).toBe("hello **world**");
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe("world");
  });

  it("inserts a placeholder when nothing is selected", () => {
    const r = applyFormat("italic", "", sel(0, 0));
    expect(r.text).toBe("_italic_");
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe("italic");
  });

  it("strikethrough + inline code wrap correctly", () => {
    expect(applyFormat("strikethrough", "x", sel(0, 1)).text).toBe("~~x~~");
    expect(applyFormat("code", "x", sel(0, 1)).text).toBe("`x`");
  });
});

describe("applyFormat — link", () => {
  it("wraps the selection as a link label and selects the url placeholder", () => {
    const r = applyFormat("link", "see docs", sel(4, 8));
    expect(r.text).toBe("see [docs](url)");
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe("url");
  });
});

describe("applyFormat — line prefixes", () => {
  it("quotes every selected line and toggles back off", () => {
    const quoted = applyFormat("quote", "a\nb", sel(0, 3));
    expect(quoted.text).toBe("> a\n> b");
    const unquoted = applyFormat(
      "quote",
      quoted.text,
      sel(0, quoted.text.length),
    );
    expect(unquoted.text).toBe("a\nb");
  });

  it("numbers a list sequentially", () => {
    const r = applyFormat("numbered", "one\ntwo\nthree", sel(0, 13));
    expect(r.text).toBe("1. one\n2. two\n3. three");
  });

  it("bullets and headings", () => {
    expect(applyFormat("bullet", "x", sel(0, 1)).text).toBe("- x");
    expect(applyFormat("heading", "Title", sel(0, 5)).text).toBe("# Title");
  });

  it("only prefixes the lines the selection touches", () => {
    const r = applyFormat("quote", "a\nb\nc", sel(2, 3)); // line "b"
    expect(r.text).toBe("a\n> b\nc");
  });
});

describe("applyFormat — code block + spoiler", () => {
  it("fences a code block around the selection", () => {
    const r = applyFormat("codeblock", "x = 1", sel(0, 5));
    expect(r.text).toBe("```\nx = 1\n```");
  });

  it("uses Reddit spoiler syntax by default", () => {
    expect(applyFormat("spoiler", "boo", sel(0, 3)).text).toBe(">!boo!<");
  });

  it("uses Lemmy spoiler block when source is lemmy", () => {
    const r = applyFormat("spoiler", "boo", sel(0, 3), { source: "lemmy" });
    expect(r.text).toBe("::: spoiler Spoiler\nboo\n:::");
  });
});
