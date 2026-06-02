/**
 * A small, dependency-free markdown renderer. Both sources feed it markdown
 * (Reddit selftext + Lemmy content are both markdown), so one renderer serves
 * the whole app. Handles paragraphs, headings, blockquotes, bullet/numbered
 * lists, fenced code, and inline bold/italic/code/links. Parser functions are
 * exported for unit testing.
 */
import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useTheme, type Theme } from "../theme";

export type InlineToken =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; content: string; url: string };

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[[^\]]+\]\([^)]+\))|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(https?:\/\/[^\s)]+)/g;

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", content: text.slice(last, m.index) });
    const raw = m[0];
    if (m[1]) tokens.push({ type: "code", content: raw.slice(1, -1) });
    else if (m[2]) tokens.push({ type: "bold", content: raw.slice(2, -2) });
    else if (m[3]) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(raw)!;
      tokens.push({ type: "link", content: link[1], url: link[2] });
    } else if (m[4]) tokens.push({ type: "italic", content: raw.slice(1, -1) });
    else if (m[5]) tokens.push({ type: "link", content: raw, url: raw });
    last = m.index + raw.length;
  }
  if (last < text.length) tokens.push({ type: "text", content: text.slice(last) });
  return tokens;
}

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

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
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
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
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: buf.join(" ") });
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

function Inline({ text, t, color }: { text: string; t: Theme; color: string }) {
  return (
    <>
      {tokenizeInline(text).map((tok, idx) => {
        if (tok.type === "bold") return <Text key={idx} style={{ fontWeight: "700", color }}>{tok.content}</Text>;
        if (tok.type === "italic") return <Text key={idx} style={{ fontStyle: "italic", color }}>{tok.content}</Text>;
        if (tok.type === "code")
          return (
            <Text key={idx} style={{ fontFamily: "SpaceMono", fontSize: 13, color: t.colors.accent }}>
              {tok.content}
            </Text>
          );
        if (tok.type === "link")
          return (
            <Text key={idx} style={{ color: t.colors.accent }} onPress={() => Linking.openURL(tok.url).catch(() => {})}>
              {tok.content}
            </Text>
          );
        return <Text key={idx} style={{ color }}>{tok.content}</Text>;
      })}
    </>
  );
}

export function Markdown({ source, color, numberOfLines }: { source: string; color?: string; numberOfLines?: number }) {
  const t = useTheme();
  const textColor = color ?? t.colors.text;
  if (!source?.trim()) return null;

  // Collapsed preview: one paragraph, clamped.
  if (numberOfLines) {
    return (
      <Text numberOfLines={numberOfLines} style={[t.type.body, { color: textColor }]}>
        <Inline text={source.replace(/\n+/g, " ").trim()} t={t} color={textColor} />
      </Text>
    );
  }

  const blocks = parseBlocks(source);
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === "heading")
          return (
            <Text key={i} style={[{ fontWeight: "700", color: textColor, marginTop: i ? t.spacing.md : 0, marginBottom: t.spacing.xs }, { fontSize: 21 - b.level * 1.5 }]}>
              <Inline text={b.text} t={t} color={textColor} />
            </Text>
          );
        if (b.type === "code")
          return (
            <View key={i} style={[styles.codeBlock, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.sm }]}>
              <Text style={{ fontFamily: "SpaceMono", fontSize: 13, color: t.colors.textSecondary }}>{b.text}</Text>
            </View>
          );
        if (b.type === "quote")
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: t.colors.accent }]}>
              <Text style={[t.type.body, { color: t.colors.textSecondary, fontStyle: "italic" }]}>
                <Inline text={b.text} t={t} color={t.colors.textSecondary} />
              </Text>
            </View>
          );
        if (b.type === "hr") return <View key={i} style={[styles.hr, { backgroundColor: t.colors.border }]} />;
        if (b.type === "list")
          return (
            <View key={i} style={{ marginVertical: t.spacing.xs }}>
              {b.items.map((it, j) => (
                <View key={j} style={styles.listRow}>
                  <Text style={[t.type.body, { color: t.colors.textSecondary, width: 22 }]}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                  <Text style={[t.type.body, { color: textColor, flex: 1 }]}>
                    <Inline text={it} t={t} color={textColor} />
                  </Text>
                </View>
              ))}
            </View>
          );
        return (
          <Text key={i} style={[t.type.body, { color: textColor, marginTop: i ? t.spacing.sm : 0 }]}>
            <Inline text={b.text} t={t} color={textColor} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  codeBlock: { padding: 10, borderWidth: StyleSheet.hairlineWidth, marginVertical: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, marginVertical: 6 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  listRow: { flexDirection: "row", alignItems: "flex-start", marginVertical: 2 },
});
