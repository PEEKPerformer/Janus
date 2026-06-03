/**
 * Pure, selection-aware markdown transforms behind the comment editor toolbar.
 * Both Reddit and Lemmy comments are markdown, so the editor stays markdown
 * (round-trips cleanly for edits) rather than WYSIWYG. Each transform takes the
 * current text + selection and returns the new text + where the selection
 * should land, so the toolbar can keep the caret sensible.
 *
 * Kept free of React/RN so the fiddly string maths is unit-tested.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface EditResult {
  text: string;
  selection: Selection;
}

export type FormatAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "link"
  | "quote"
  | "bullet"
  | "numbered"
  | "heading"
  | "codeblock"
  | "spoiler";

export interface FormatOptions {
  /** Spoiler syntax differs per source (Reddit >!…!< vs Lemmy ::: spoiler). */
  source?: "reddit" | "lemmy";
}

function clampSel(text: string, sel: Selection): Selection {
  const start = Math.max(0, Math.min(sel.start, text.length));
  const end = Math.max(start, Math.min(sel.end, text.length));
  return { start, end };
}

/** Wrap the selection with `before`/`after`; selects a placeholder if empty. */
function wrap(
  text: string,
  sel: Selection,
  before: string,
  after: string,
  placeholder: string,
): EditResult {
  const selected = text.slice(sel.start, sel.end);
  const inner = selected || placeholder;
  const next =
    text.slice(0, sel.start) + before + inner + after + text.slice(sel.end);
  const start = sel.start + before.length;
  return { text: next, selection: { start, end: start + inner.length } };
}

/** Insert `[label](url)` and select the `url` placeholder for quick typing. */
function link(text: string, sel: Selection): EditResult {
  const label = text.slice(sel.start, sel.end) || "text";
  const url = "url";
  const composed = `[${label}](${url})`;
  const next = text.slice(0, sel.start) + composed + text.slice(sel.end);
  const urlStart = sel.start + 1 + label.length + 2; // after "[label]("
  return {
    text: next,
    selection: { start: urlStart, end: urlStart + url.length },
  };
}

function lineBounds(
  text: string,
  sel: Selection,
): { start: number; end: number } {
  const start = text.lastIndexOf("\n", sel.start - 1) + 1;
  let end = text.indexOf("\n", sel.end);
  if (end === -1) end = text.length;
  // A zero-length selection sitting on a line boundary still selects that line.
  if (sel.end > sel.start && text[sel.end - 1] === "\n") end = sel.end - 1;
  return { start, end };
}

/**
 * Prefix each line in the selection (toggle off if every line already has it).
 * `makePrefix(i)` supports numbered lists; `isPrefixed`/`strip` enable toggling.
 */
function prefixLines(
  text: string,
  sel: Selection,
  makePrefix: (i: number) => string,
  isPrefixed: (line: string) => boolean,
  strip: (line: string) => string,
): EditResult {
  const { start, end } = lineBounds(text, sel);
  const lines = text.slice(start, end).split("\n");
  const allPrefixed = lines.every((l) => isPrefixed(l));
  const next = (
    allPrefixed ? lines.map(strip) : lines.map((l, i) => makePrefix(i) + l)
  ).join("\n");
  const composed = text.slice(0, start) + next + text.slice(end);
  return { text: composed, selection: { start, end: start + next.length } };
}

function fence(text: string, sel: Selection): EditResult {
  const selected = text.slice(sel.start, sel.end) || "code";
  const composed = "```\n" + selected + "\n```";
  const next = text.slice(0, sel.start) + composed + text.slice(sel.end);
  const innerStart = sel.start + 4; // after "```\n"
  return {
    text: next,
    selection: { start: innerStart, end: innerStart + selected.length },
  };
}

function spoiler(
  text: string,
  sel: Selection,
  source?: "reddit" | "lemmy",
): EditResult {
  if (source === "lemmy") {
    const inner = text.slice(sel.start, sel.end) || "hidden";
    const composed = `::: spoiler Spoiler\n${inner}\n:::`;
    const next = text.slice(0, sel.start) + composed + text.slice(sel.end);
    const innerStart = sel.start + "::: spoiler Spoiler\n".length;
    return {
      text: next,
      selection: { start: innerStart, end: innerStart + inner.length },
    };
  }
  return wrap(text, sel, ">!", "!<", "spoiler");
}

/** Apply a toolbar format to the text/selection. Never throws. */
export function applyFormat(
  action: FormatAction,
  text: string,
  rawSel: Selection,
  opts: FormatOptions = {},
): EditResult {
  const sel = clampSel(text, rawSel);
  switch (action) {
    case "bold":
      return wrap(text, sel, "**", "**", "bold");
    case "italic":
      return wrap(text, sel, "_", "_", "italic");
    case "strikethrough":
      return wrap(text, sel, "~~", "~~", "strikethrough");
    case "code":
      return wrap(text, sel, "`", "`", "code");
    case "link":
      return link(text, sel);
    case "codeblock":
      return fence(text, sel);
    case "spoiler":
      return spoiler(text, sel, opts.source);
    case "quote":
      return prefixLines(
        text,
        sel,
        () => "> ",
        (l) => l.startsWith("> "),
        (l) => l.replace(/^> /, ""),
      );
    case "bullet":
      return prefixLines(
        text,
        sel,
        () => "- ",
        (l) => l.startsWith("- "),
        (l) => l.replace(/^- /, ""),
      );
    case "numbered":
      return prefixLines(
        text,
        sel,
        (i) => `${i + 1}. `,
        (l) => /^\d+\.\s/.test(l),
        (l) => l.replace(/^\d+\.\s/, ""),
      );
    case "heading":
      return prefixLines(
        text,
        sel,
        () => "# ",
        (l) => l.startsWith("# "),
        (l) => l.replace(/^# /, ""),
      );
  }
}
