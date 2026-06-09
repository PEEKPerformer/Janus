/**
 * Community twins — the curated map between Reddit subreddits and their best
 * Lemmy counterparts (and vice-versa). This is Janus's signature
 * cross-network move: standing on a subreddit and being told "there's a real,
 * active home for this on the Fediverse too."
 *
 * Curation beats an auto name-match because the failure mode of automation is
 * exactly what destroys trust — surfacing a 4-subscriber ghost community or a
 * topic collision. Curated entries are hand-verified and get a confident
 * "verified twin" treatment; everything else falls back to a clearly-labelled,
 * threshold-gated *suggestion* (see {@link suggestTwinSearch}). The table is
 * deliberately plain data so it's trivial to extend (or, later, accept PRs /
 * a community-confirm loop).
 *
 * Note `r/AskReddit → asklemmy@lemmy.ml`: the names don't match at all, which is
 * precisely the kind of mapping only curation can get right.
 */

export interface CommunityTwin {
  /** Human-readable topic label. */
  topic: string;
  /** Subreddit name, lower-case, without the `r/`. */
  reddit: string;
  /** Lemmy counterpart handle(s) `name@instance`, best/most-active first. */
  lemmy: string[];
}

/** A twin resolved for display on the *other* network from where you are. */
export interface TwinSuggestion {
  source: "reddit" | "lemmy";
  /** Display handle: `r/name` or `name@instance`. */
  handle: string;
  /** Bare routing name (subreddit name, or Lemmy community local part). */
  name: string;
  /** Lemmy instance host (absent for Reddit). */
  instance?: string;
  /** True for curated entries; false for heuristic suggestions. */
  verified: boolean;
}

// Hand-curated, verified twins. Kept modest and high-quality on purpose:
// better to confidently cover the obvious big rooms than to shakily "cover"
// everything. Extend freely — it's just data.
export const CURATED_TWINS: CommunityTwin[] = [
  {
    topic: "Technology",
    reddit: "technology",
    lemmy: ["technology@lemmy.world"],
  },
  { topic: "Science", reddit: "science", lemmy: ["science@lemmy.world"] },
  { topic: "World News", reddit: "worldnews", lemmy: ["worldnews@lemmy.ml"] },
  { topic: "News", reddit: "news", lemmy: ["news@lemmy.world"] },
  {
    topic: "Programming",
    reddit: "programming",
    lemmy: ["programming@programming.dev"],
  },
  { topic: "Linux", reddit: "linux", lemmy: ["linux@lemmy.ml"] },
  { topic: "Privacy", reddit: "privacy", lemmy: ["privacy@lemmy.ml"] },
  {
    topic: "Self-hosting",
    reddit: "selfhosted",
    lemmy: ["selfhosted@lemmy.world"],
  },
  { topic: "Homelab", reddit: "homelab", lemmy: ["homelab@lemmy.ml"] },
  {
    topic: "Open Source",
    reddit: "opensource",
    lemmy: ["opensource@lemmy.ml"],
  },
  { topic: "Fediverse", reddit: "fediverse", lemmy: ["fediverse@lemmy.world"] },
  { topic: "Firefox", reddit: "firefox", lemmy: ["firefox@lemmy.ml"] },
  { topic: "DeGoogle", reddit: "degoogle", lemmy: ["degoogle@lemmy.ml"] },
  {
    topic: "Data Hoarding",
    reddit: "datahoarder",
    lemmy: ["datahoarder@lemmy.ml"],
  },
  {
    topic: "Cybersecurity",
    reddit: "cybersecurity",
    lemmy: ["cybersecurity@sh.itjust.works"],
  },
  {
    topic: "Android",
    reddit: "android",
    lemmy: ["android@lemdro.id", "android@lemmy.world"],
  },
  { topic: "Apple", reddit: "apple", lemmy: ["apple@lemmy.world"] },
  { topic: "Python", reddit: "python", lemmy: ["python@programming.dev"] },
  { topic: "Rust", reddit: "rust", lemmy: ["rust@programming.dev"] },
  { topic: "Web Dev", reddit: "webdev", lemmy: ["webdev@programming.dev"] },
  {
    topic: "Gaming",
    reddit: "gaming",
    lemmy: ["gaming@lemmy.world", "games@lemmy.world"],
  },
  { topic: "PC Gaming", reddit: "pcgaming", lemmy: ["pcgaming@lemmy.ca"] },
  { topic: "Movies", reddit: "movies", lemmy: ["movies@lemmy.world"] },
  {
    topic: "Television",
    reddit: "television",
    lemmy: ["television@lemmy.world"],
  },
  { topic: "Music", reddit: "music", lemmy: ["music@lemmy.world"] },
  { topic: "Books", reddit: "books", lemmy: ["books@lemmy.world"] },
  { topic: "Space", reddit: "space", lemmy: ["space@lemmy.world"] },
  { topic: "Ask (general)", reddit: "askreddit", lemmy: ["asklemmy@lemmy.ml"] },
  {
    topic: "Explain Like I'm Five",
    reddit: "explainlikeimfive",
    lemmy: ["explainlikeimfive@lemmy.world"],
  },
  {
    topic: "Today I Learned",
    reddit: "todayilearned",
    lemmy: ["todayilearned@lemmy.world"],
  },
  {
    topic: "Showerthoughts",
    reddit: "showerthoughts",
    lemmy: ["showerthoughts@lemmy.world"],
  },
  {
    topic: "Mildly Interesting",
    reddit: "mildlyinteresting",
    lemmy: ["mildlyinteresting@lemmy.world"],
  },
  { topic: "Memes", reddit: "memes", lemmy: ["memes@lemmy.world"] },
  { topic: "Piracy", reddit: "piracy", lemmy: ["piracy@lemmy.dbzer0.com"] },
  {
    topic: "Selfhosted Buildapc",
    reddit: "buildapc",
    lemmy: ["buildapc@lemmy.world"],
  },
  {
    topic: "Photography",
    reddit: "photography",
    lemmy: ["photography@lemmy.world"],
  },
  {
    topic: "Politics (US)",
    reddit: "politics",
    lemmy: ["politics@lemmy.world"],
  },
  { topic: "Sports", reddit: "sports", lemmy: ["sports@lemmy.world"] },
  { topic: "Food", reddit: "food", lemmy: ["food@lemmy.world"] },
  { topic: "Til Funny", reddit: "funny", lemmy: ["funny@lemmy.world"] },
];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/^r\//, "").replace(/^\/+/, "");
}

/** Split a Lemmy handle "name@instance" (or bare "name") into parts. */
export function splitLemmyHandle(handle: string): {
  name: string;
  instance?: string;
} {
  const [name, instance] = norm(handle).split("@");
  return { name, instance };
}

/**
 * Curated twins on the OTHER network for a given community. Returns [] when no
 * curated mapping exists (callers may then fall back to {@link suggestTwinSearch}).
 */
export function curatedTwinsFor(input: {
  source: "reddit" | "lemmy";
  /** Subreddit name (Reddit) or community local part / handle (Lemmy). */
  name: string;
}): TwinSuggestion[] {
  const name = norm(input.name);
  if (input.source === "reddit") {
    const entry = CURATED_TWINS.find((tw) => tw.reddit === name);
    if (!entry) return [];
    return entry.lemmy.map((h) => {
      const { name: ln, instance } = splitLemmyHandle(h);
      return {
        source: "lemmy",
        handle: h,
        name: ln,
        instance,
        verified: true,
      };
    });
  }
  // Lemmy → Reddit: match the community's local part against any twin's lemmy list.
  const local = splitLemmyHandle(name).name;
  const entry = CURATED_TWINS.find((tw) =>
    tw.lemmy.some((h) => splitLemmyHandle(h).name === local),
  );
  if (!entry) return [];
  return [
    {
      source: "reddit",
      handle: `r/${entry.reddit}`,
      name: entry.reddit,
      verified: true,
    },
  ];
}

/**
 * The query + acceptance bar for the *suggested* (uncurated) tier. The shell
 * runs the search on the other network's adapter; a match should only be shown
 * if it clears these thresholds, and always labelled as a guess. Kept here so
 * the policy is one testable place rather than sprinkled through the UI.
 */
export const SUGGESTION_MIN_SUBSCRIBERS = 500;

export function suggestTwinSearch(input: {
  source: "reddit" | "lemmy";
  name: string;
}): { otherSource: "reddit" | "lemmy"; query: string } {
  return {
    otherSource: input.source === "reddit" ? "lemmy" : "reddit",
    query: splitLemmyHandle(norm(input.name)).name,
  };
}

/** A candidate clears the suggested bar (active enough to be worth showing). */
export function isAcceptableSuggestion(
  candidate: {
    name: string;
    subscriberCount: number;
  },
  query: string,
): boolean {
  return (
    candidate.subscriberCount >= SUGGESTION_MIN_SUBSCRIBERS &&
    norm(candidate.name) === norm(query)
  );
}
