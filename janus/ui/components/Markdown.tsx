/**
 * A small, dependency-free markdown renderer. Both sources feed it markdown
 * (Reddit selftext + Lemmy content are both markdown), so one renderer serves
 * the whole app. Handles paragraphs, headings, blockquotes, bullet/numbered
 * lists, fenced code, GFM pipe tables, and inline bold/italic/strikethrough/
 * code/links/images, Reddit `>!spoilers!<` and `^superscript`. Parser
 * functions are exported for unit testing.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, type Theme } from "../theme";
import { openLink, isHttpUrl } from "../links";
import { openImageViewer } from "../imageViewer";

export type InlineToken =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "strike"; content: string }
  | { type: "superscript"; content: string }
  | { type: "spoiler"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; content: string; url: string }
  // Lemmy/Hexbear custom emoji: `![shortcode](url "emoji shortcode")`.
  | { type: "emoji"; content: string; url: string }
  // Any other markdown image `![alt](url)`.
  | { type: "image"; content: string; url: string };

// Image `![alt](url "title")` is matched FIRST (its leading `!` precedes the
// link `[..](..)` form). Underscore emphasis is intentionally NOT supported so
// snake_case identifiers don't italicize mid-word. Bare URLs greedily match to
// whitespace, then trailing punctuation / unbalanced parens are trimmed off.
// Trailing groups (7-9) add GFM strikethrough, Reddit `>!spoiler!<`, and
// Reddit superscript `^(text)` / `^word`.
const INLINE_RE =
  /(!\[[^\]]*\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\s][^*]*\*)|(https?:\/\/[^\s]+)|(~~[^~]+~~)|(>!.+?!<)|(\^\([^)]+\)|\^[^\s)]+)/g;

/** Split an image's inner `(url "optional title")` into url + title. */
function parseImageInner(inner: string): { url: string; title?: string } {
  const m = /^(\S+)(?:\s+"([^"]*)")?\s*$/.exec(inner.trim());
  if (!m) return { url: inner.trim() };
  return { url: m[1], title: m[2] };
}

function trimBareUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?]+$/, "");
  while (
    url.endsWith(")") &&
    url.split("(").length - 1 < url.split(")").length - 1
  ) {
    url = url.slice(0, -1);
  }
  return url;
}

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last)
      tokens.push({ type: "text", content: text.slice(last, m.index) });
    const raw = m[0];
    if (m[1]) {
      const img = /!\[([^\]]*)\]\(([^)]+)\)/.exec(raw)!;
      const alt = img[1];
      const { url, title } = parseImageInner(img[2]);
      // Lemmy marks custom emoji with a `"emoji <shortcode>"` title.
      if (title && /^emoji(\s|$)/i.test(title)) {
        tokens.push({
          type: "emoji",
          content: alt || title.replace(/^emoji\s*/i, ""),
          url,
        });
      } else {
        tokens.push({ type: "image", content: alt, url });
      }
    } else if (m[2]) tokens.push({ type: "code", content: raw.slice(1, -1) });
    else if (m[3]) tokens.push({ type: "bold", content: raw.slice(2, -2) });
    else if (m[4]) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(raw)!;
      tokens.push({ type: "link", content: link[1], url: link[2] });
    } else if (m[5]) tokens.push({ type: "italic", content: raw.slice(1, -1) });
    else if (m[6]) {
      const url = trimBareUrl(raw);
      tokens.push({ type: "link", content: url, url });
      const suffix = raw.slice(url.length);
      if (suffix) tokens.push({ type: "text", content: suffix });
    } else if (m[7]) tokens.push({ type: "strike", content: raw.slice(2, -2) });
    else if (m[8]) tokens.push({ type: "spoiler", content: raw.slice(2, -2) });
    else if (m[9]) {
      const inner = raw.startsWith("^(") ? raw.slice(2, -1) : raw.slice(1);
      tokens.push({ type: "superscript", content: inner });
    }
    last = m.index + raw.length;
  }
  if (last < text.length)
    tokens.push({ type: "text", content: text.slice(last) });
  return tokens;
}

const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 18, 3: 16 };

export type TableAlign = "left" | "center" | "right";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "table"; header: string[]; align: TableAlign[]; rows: string[][] }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

/** Split a GFM table row into trimmed cells, dropping the outer pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * A `|---|:--:|--:|` divider line under a table header. Requires a pipe so a
 * bare `---` (horizontal rule) under a paragraph isn't mistaken for a table.
 */
function isTableSeparator(line: string): boolean {
  return (
    line.includes("-") &&
    line.includes("|") &&
    /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
  );
}

function cellAlign(sep: string): TableAlign {
  const s = sep.trim();
  const l = s.startsWith(":");
  const r = s.endsWith(":");
  return l && r ? "center" : r ? "right" : "left";
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", text: para.join(" ").trim() });
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        buf.push(lines[i++]);
      i++; // closing fence
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">"))
        buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: buf.join(" ") });
      continue;
    }
    // GFM table: a header row, then a |---|---| separator, then body rows.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flush();
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }
    const listMatch = /^\s*([-*+]|\d+\.)\s+/.test(line);
    if (listMatch) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
      }
      blocks.push({ type: "list", items, ordered });
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

function renderToken(
  tok: InlineToken,
  idx: number,
  t: Theme,
  color: string,
): React.ReactNode {
  if (tok.type === "bold")
    return (
      <Text key={idx} style={{ fontWeight: "700", color }}>
        {tok.content}
      </Text>
    );
  if (tok.type === "italic")
    return (
      <Text key={idx} style={{ fontStyle: "italic", color }}>
        {tok.content}
      </Text>
    );
  if (tok.type === "strike")
    return (
      <Text key={idx} style={{ textDecorationLine: "line-through", color }}>
        {tok.content}
      </Text>
    );
  if (tok.type === "superscript")
    // RN Text has no real vertical-align; approximate a footnote with a
    // smaller glyph (Reddit superscript is mostly tiny disclaimers anyway).
    return (
      <Text key={idx} style={{ fontSize: 10, color }}>
        {tok.content}
      </Text>
    );
  if (tok.type === "spoiler")
    return <SpoilerText key={idx} content={tok.content} color={color} t={t} />;
  if (tok.type === "code")
    return (
      <Text
        key={idx}
        style={{
          fontFamily: "SpaceMono",
          fontSize: 13,
          color: t.colors.accent,
        }}
      >
        {tok.content}
      </Text>
    );
  if (tok.type === "link" || tok.type === "image")
    return (
      <Text
        key={idx}
        accessibilityRole="link"
        accessibilityLabel={
          tok.type === "image" ? `Image: ${tok.content || "open"}` : undefined
        }
        style={{ color: t.colors.accent, textDecorationLine: "underline" }}
        onPress={() => {
          void openLink(tok.url);
        }}
      >
        {tok.type === "image" ? `🖼 ${tok.content || "image"}` : tok.content}
      </Text>
    );
  if (tok.type === "emoji")
    return (
      <ExpoImage
        key={idx}
        source={{ uri: tok.url }}
        style={styles.emoji}
        accessibilityLabel={`:${tok.content}:`}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    );
  return (
    <Text key={idx} style={{ color }}>
      {tok.content}
    </Text>
  );
}

function Inline({ text, t, color }: { text: string; t: Theme; color: string }) {
  return (
    <>
      {tokenizeInline(text).map((tok, idx) => renderToken(tok, idx, t, color))}
    </>
  );
}

/** Reddit `>!spoiler!<` — a blacked-out bar that reveals its text on tap. */
function SpoilerText({
  content,
  color,
  t,
}: {
  content: string;
  color: string;
  t: Theme;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Text
      onPress={() => setRevealed(true)}
      accessibilityRole="button"
      accessibilityLabel={revealed ? content : "Spoiler. Tap to reveal."}
      style={
        revealed
          ? { color }
          : { color: "transparent", backgroundColor: t.colors.textTertiary }
      }
    >
      {content}
    </Text>
  );
}

/** A GFM pipe table — header row bold, equal-width columns, per-column align. */
function MarkdownTable({
  block,
  t,
  color,
}: {
  block: Extract<Block, { type: "table" }>;
  t: Theme;
  color: string;
}) {
  const cols = block.header.length;
  const cell = (text: string, idx: number, bold: boolean) => (
    <Text
      key={idx}
      style={[
        t.type.small,
        {
          flex: 1,
          color: bold ? color : t.colors.textSecondary,
          fontWeight: bold ? "700" : "400",
          textAlign: block.align[idx] ?? "left",
          paddingVertical: 5,
          paddingHorizontal: 6,
        },
      ]}
    >
      <Inline text={text} t={t} color={bold ? color : t.colors.textSecondary} />
    </Text>
  );
  return (
    <View style={[styles.table, { borderColor: t.colors.border }]}>
      <View
        style={[
          styles.tableRow,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
          },
        ]}
      >
        {block.header.map((h, j) => cell(h, j, true))}
      </View>
      {block.rows.map((r, ri) => (
        <View
          key={ri}
          style={[
            styles.tableRow,
            {
              borderColor: t.colors.border,
              borderBottomWidth:
                ri === block.rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
            },
          ]}
        >
          {Array.from({ length: cols }).map((_, j) =>
            cell(r[j] ?? "", j, false),
          )}
        </View>
      ))}
    </View>
  );
}

/** A real, collapsible inline image — replaces the old "🖼 image" text link. */
function MarkdownImage({ uri, alt }: { uri: string; alt: string }) {
  const t = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [ratio, setRatio] = useState(1.6);
  const label = alt?.trim() || "Image";

  return (
    <View style={{ marginVertical: t.spacing.sm }}>
      <Pressable
        onPress={() => setCollapsed((c) => !c)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={
          collapsed ? `Show image: ${label}` : `Hide image: ${label}`
        }
        style={[
          styles.imgHeader,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
          },
        ]}
      >
        <Ionicons
          name="image-outline"
          size={14}
          color={t.colors.textTertiary}
        />
        <Text
          style={[
            t.type.small,
            { color: t.colors.textSecondary, flex: 1, marginLeft: 6 },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Ionicons
          name={collapsed ? "chevron-down" : "chevron-up"}
          size={16}
          color={t.colors.textTertiary}
        />
      </Pressable>
      {!collapsed ? (
        <Pressable
          onPress={() => openImageViewer([uri], 0)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Open image: ${label}`}
        >
          <ExpoImage
            source={{ uri }}
            style={{
              width: "100%",
              aspectRatio: ratio,
              borderBottomLeftRadius: t.radius.sm,
              borderBottomRightRadius: t.radius.sm,
              backgroundColor: t.colors.skeleton,
            }}
            contentFit="contain"
            transition={120}
            onLoad={(e) => {
              const { width, height } = e.source ?? {};
              if (width && height)
                setRatio(Math.min(Math.max(width / height, 0.5), 2.2));
            }}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Render a paragraph, splitting standalone markdown images out as real
 * (collapsible) image blocks while keeping surrounding text inline. Images on
 * their own line — the common case in posts/comments — become actual images
 * instead of a "🖼 image" link.
 */
function BlockText({
  text,
  t,
  color,
  topMargin,
}: {
  text: string;
  t: Theme;
  color: string;
  topMargin: number;
}) {
  const tokens = tokenizeInline(text);
  const hasImage = tokens.some((tok) => tok.type === "image");
  if (!hasImage) {
    return (
      <Text style={[t.type.body, { color, marginTop: topMargin }]}>
        {tokens.map((tok, idx) => renderToken(tok, idx, t, color))}
      </Text>
    );
  }
  // Interleave text runs and image blocks.
  const out: React.ReactNode[] = [];
  let run: InlineToken[] = [];
  let part = 0;
  const flush = () => {
    if (run.length) {
      const tokensForRun = run;
      out.push(
        <Text key={`t${part}`} style={[t.type.body, { color }]}>
          {tokensForRun.map((tok, idx) => renderToken(tok, idx, t, color))}
        </Text>,
      );
      run = [];
      part += 1;
    }
  };
  tokens.forEach((tok, idx) => {
    if (tok.type === "image" && isHttpUrl(tok.url)) {
      flush();
      out.push(
        <MarkdownImage key={`img${idx}`} uri={tok.url} alt={tok.content} />,
      );
    } else {
      run.push(tok);
    }
  });
  flush();
  return <View style={{ marginTop: topMargin }}>{out}</View>;
}

export function Markdown({
  source,
  color,
  numberOfLines,
}: {
  source: string;
  color?: string;
  numberOfLines?: number;
}) {
  const t = useTheme();
  const textColor = color ?? t.colors.text;
  if (!source?.trim()) return null;

  // Collapsed preview: one paragraph, clamped.
  if (numberOfLines) {
    return (
      <Text
        numberOfLines={numberOfLines}
        style={[t.type.body, { color: textColor }]}
      >
        <Inline
          text={source.replace(/\n+/g, " ").trim()}
          t={t}
          color={textColor}
        />
      </Text>
    );
  }

  const blocks = parseBlocks(source);
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === "heading")
          return (
            <Text
              key={i}
              accessibilityRole="header"
              style={{
                fontWeight: "700",
                color: textColor,
                marginTop: i ? t.spacing.md : 0,
                marginBottom: t.spacing.xs,
                fontSize: HEADING_SIZE[b.level] ?? 15,
              }}
            >
              <Inline text={b.text} t={t} color={textColor} />
            </Text>
          );
        if (b.type === "code")
          return (
            <View
              key={i}
              style={[
                styles.codeBlock,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.sm,
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: "SpaceMono",
                  fontSize: 13,
                  color: t.colors.textSecondary,
                }}
              >
                {b.text}
              </Text>
            </View>
          );
        if (b.type === "quote")
          return (
            <View
              key={i}
              style={[styles.quote, { borderLeftColor: t.colors.accent }]}
            >
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.textSecondary, fontStyle: "italic" },
                ]}
              >
                <Inline text={b.text} t={t} color={t.colors.textSecondary} />
              </Text>
            </View>
          );
        if (b.type === "table")
          return <MarkdownTable key={i} block={b} t={t} color={textColor} />;
        if (b.type === "hr")
          return (
            <View
              key={i}
              style={[styles.hr, { backgroundColor: t.colors.border }]}
            />
          );
        if (b.type === "list")
          return (
            <View key={i} style={{ marginVertical: t.spacing.xs }}>
              {b.items.map((it, j) => (
                <View key={j} style={styles.listRow}>
                  <Text
                    style={[
                      t.type.body,
                      { color: t.colors.textSecondary, width: 22 },
                    ]}
                  >
                    {b.ordered ? `${j + 1}.` : "•"}
                  </Text>
                  <Text style={[t.type.body, { color: textColor, flex: 1 }]}>
                    <Inline text={it} t={t} color={textColor} />
                  </Text>
                </View>
              ))}
            </View>
          );
        return (
          <BlockText
            key={i}
            text={b.text}
            t={t}
            color={textColor}
            topMargin={i ? t.spacing.sm : 0}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  emoji: { width: 20, height: 20 },
  imgHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  codeBlock: {
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 6,
  },
  quote: { borderLeftWidth: 3, paddingLeft: 10, marginVertical: 6 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    marginVertical: 6,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginVertical: 2,
  },
});
