/**
 * Parse an incoming share URL (Reddit or Lemmy) into a navigable target. Pure
 * and source-aware so the shell can route a link tapped in another app — or the
 * app's own "open in Janus" — to the right screen across both networks.
 */

export type DeepLinkTarget =
  | { kind: "community"; source: "reddit"; name: string }
  | {
      kind: "community";
      source: "lemmy";
      instance: string;
      name: string;
      handle: string;
    }
  | { kind: "post"; source: "reddit"; postId: string; community?: string }
  | { kind: "post"; source: "lemmy"; instance: string; postId: string }
  | { kind: "user"; source: "reddit"; name: string }
  | { kind: "user"; source: "lemmy"; instance: string; name: string };

const REDDIT_HOSTS = /(^|\.)reddit\.com$/i;

function splitUrl(raw: string): { host: string; segments: string[] } | null {
  const m = /^https?:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(raw.trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  const path = m[2] ?? "";
  const segments = path.split("/").filter(Boolean);
  return { host, segments };
}

export function parseShareUrl(raw: string): DeepLinkTarget | null {
  const parsed = splitUrl(raw);
  if (!parsed) return null;
  const { host, segments } = parsed;

  if (REDDIT_HOSTS.test(host)) {
    // /r/{sub}/comments/{id}/...  ·  /r/{sub}  ·  /u|user/{name}
    if (segments[0] === "r" && segments[1]) {
      const sub = segments[1];
      if (segments[2] === "comments" && segments[3]) {
        return {
          kind: "post",
          source: "reddit",
          postId: segments[3],
          community: sub,
        };
      }
      return { kind: "community", source: "reddit", name: sub };
    }
    if ((segments[0] === "u" || segments[0] === "user") && segments[1]) {
      return { kind: "user", source: "reddit", name: segments[1] };
    }
    return null;
  }

  // Otherwise treat the host as a Lemmy instance.
  if (segments[0] === "c" && segments[1]) {
    // community may be bare ("tech") or qualified ("tech@other.world").
    const [name, qualified] = segments[1].split("@");
    const instance = qualified || host;
    const handle = qualified ? `${name}@${qualified}` : name;
    return { kind: "community", source: "lemmy", instance, name, handle };
  }
  if (segments[0] === "post" && segments[1]) {
    return {
      kind: "post",
      source: "lemmy",
      instance: host,
      postId: segments[1],
    };
  }
  if (segments[0] === "u" && segments[1]) {
    const [name, qualified] = segments[1].split("@");
    return {
      kind: "user",
      source: "lemmy",
      instance: qualified || host,
      name,
    };
  }
  return null;
}
