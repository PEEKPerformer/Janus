/**
 * Demo mode — fixture adapters piped into the real app.
 *
 * Activated by EXPO_PUBLIC_DEMO=1 at bundle time (see janus/entry.tsx). The
 * whole UI runs unchanged against invented content, which is what makes demo
 * screenshots both REAL (the genuine app rendering, not a mock) and
 * publishable (no one's private feed, no real usernames).
 *
 * `seedDemoState()` stages the stateful features the feed shows:
 *  - AI Lens verdict chips: marks the model "ready" (demo revision) and writes
 *    verdicts into the same MMKV cache `cachedVerdict` reads.
 *  - "+N new comments": records past thread visits with lower comment counts.
 * Everything else (source badges, pins, repost collapse) is plain fixture data.
 */

import { createMMKV } from "react-native-mmkv";

import type {
  SourceAdapter,
  AccountRef,
  FeedQuery,
  LoginChallenge,
  LoginInput,
  SecretBundle,
  SubmitPostInput,
  JanusFile,
  SearchKind,
  UserContentKind,
  VoteResult,
  ResolvedRemote,
} from "../../core/adapter";
import type {
  Post,
  Comment,
  Community,
  User,
  Notification,
  Conversation,
  DirectMessage,
  RichText,
  Route,
} from "../../core/model";
import { buildId, dedupKey, type JanusId } from "../../core/ids";
import { Vote } from "../../core/vote";
import { emptyPage, type Page, type PageRequest } from "../../core/pagination";
import { REDDIT_CAPABILITIES } from "../reddit/capabilities";
import { LEMMY_CAPABILITIES } from "../lemmy/capabilities";
import { textKey } from "../../app/aiLens";
import { setAiLensPolicy } from "../../app/aiLensPolicy";
import { setPangramState } from "../../app/pangramModel";
import { MANIFEST } from "../../app/pangramGraphAsset";
import {
  initThreadVisits,
  recordVisit,
  flushThreadVisits,
} from "../../app/threadVisits";

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Deterministic, copyright-free thumbnails. */
const pic = (seed: string, w = 600, h = 450) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

function text(markdown: string): RichText {
  return { markdown, text: markdown };
}

function route(source: "reddit" | "lemmy", instance: string): Route {
  return { source, instance, kind: "post", params: {} };
}

interface Fix {
  source: "reddit" | "lemmy";
  instance: string;
  native: string;
  title: string;
  community: string;
  author: string;
  ageMs: number;
  score: number;
  comments: number;
  body?: string;
  thumbSeed?: string;
  externalLink?: string;
  stickied?: boolean;
}

function demoPost(f: Fix): Post {
  const id = buildId({
    source: f.source,
    instance: f.instance,
    kind: "post",
    nativeId: f.native,
  });
  const communityId = buildId({
    source: f.source,
    instance: f.instance,
    kind: "community",
    nativeId: f.community,
  });
  const isReddit = f.source === "reddit";
  const media = f.thumbSeed
    ? [
        {
          kind: "image" as const,
          url: pic(f.thumbSeed, 1200, 900),
          thumbnailUrl: pic(f.thumbSeed),
          width: 1200,
          height: 900,
          aspectRatio: 4 / 3,
          isNSFW: false,
        },
      ]
    : [];
  return {
    id,
    dedupKey: dedupKey(
      isReddit ? `t3_${f.native}` : `https://${f.instance}/post/${f.native}`,
    ),
    source: f.source,
    instance: f.instance,
    title: f.title,
    author: {
      id: buildId({
        source: f.source,
        instance: f.instance,
        kind: "user",
        nativeId: f.author,
      }),
      username: f.author,
      handle: isReddit ? `u/${f.author}` : f.author,
    },
    community: {
      id: communityId,
      name: f.community,
      handle: isReddit ? `r/${f.community}` : f.community,
    },
    createdAt: NOW - f.ageMs,
    score: f.score,
    scoreHidden: false,
    userVote: Vote.None,
    commentCount: f.comments,
    saved: false,
    isNSFW: false,
    isSpoiler: false,
    isStickied: !!f.stickied,
    canModerate: false,
    isRemoved: false,
    interactionStatus: null,
    body: f.body ? text(f.body) : {},
    media,
    externalLink: f.externalLink,
    thumbnail: media[0],
    permalinkRoute: route(f.source, f.instance),
    ext: isReddit
      ? { source: "reddit" }
      : {
          source: "lemmy",
          apId: `https://${f.instance}/post/${f.native}`,
          local: true,
          featuredCommunity: !!f.stickied,
        },
  };
}

// The megathread body — long enough to be judge-able, and the text the demo
// human verdict is cached against.
const MEGATHREAD_BODY = [
  "Welcome to this week's world news megathread. Drop links and discussion",
  "below; please keep sources reputable and add context when you post a",
  "headline. Yesterday's biggest thread was the summit coverage, which is",
  "still developing this morning, so check the stickied comment for the",
  "running timeline before posting duplicates. Be kind to each other.",
].join(" ");

const JANUS_WIKI = "https://en.wikipedia.org/wiki/Janus";

export const DEMO_REDDIT_POSTS: Post[] = [
  demoPost({
    source: "reddit",
    instance: "www.reddit.com",
    native: "demo2",
    title:
      "git commit -m 'just unify two social networks real quick' — 1,400 files changed",
    community: "ProgrammerHumor",
    author: "git_blame_me",
    ageMs: 1 * HOUR,
    score: 8_800,
    comments: 540,
    thumbSeed: "gitdiff",
  }),
  demoPost({
    source: "reddit",
    instance: "www.reddit.com",
    native: "demo1",
    title:
      "TIL the Roman god Janus had two faces — one to read Reddit, one to read Lemmy at the same time",
    community: "todayilearned",
    author: "two_faced_fan",
    ageMs: 38 * MIN,
    score: 41_200,
    comments: 1_800,
    thumbSeed: "janusbust",
    externalLink: JANUS_WIKI,
  }),
  demoPost({
    source: "reddit",
    instance: "www.reddit.com",
    native: "demo3",
    title: "Went outside today. Both Reddit AND Lemmy demanded photo proof.",
    community: "outside",
    author: "touched_grass_once",
    ageMs: 2 * HOUR,
    score: 32_000,
    comments: 89,
    thumbSeed: "meadow",
  }),
];

export const DEMO_LEMMY_POSTS: Post[] = [
  demoPost({
    source: "lemmy",
    instance: "lemmy.world",
    native: "9001",
    title: "World News Megathread — June 8th to 14th · daily discussion",
    community: "news",
    author: "daily_lurker",
    ageMs: 3 * DAY,
    score: 142,
    comments: 823,
    body: MEGATHREAD_BODY,
    thumbSeed: "globe",
    stickied: true,
  }),
  // Cross-network twin of the TIL link — same URL, so the feed's repost
  // collapse folds them into one card ("Also in 2 communities").
  demoPost({
    source: "lemmy",
    instance: "lemmy.world",
    native: "9002",
    title: "TIL the Roman god Janus had two faces (Reddit and Lemmy, clearly)",
    community: "technology",
    author: "openweb_enjoyer",
    ageMs: 52 * MIN,
    score: 1_900,
    comments: 211,
    thumbSeed: "janusbust",
    externalLink: JANUS_WIKI,
  }),
  demoPost({
    source: "lemmy",
    instance: "lemmy.world",
    native: "9003",
    title:
      "What's one app feature you'll never give up once you've had it? I'll start: cross-posts folding into one card",
    community: "asklemmy",
    author: "curious_penguin",
    ageMs: 1 * HOUR,
    score: 642,
    comments: 1_300,
  }),
];

function demoComments(post: Post): Comment[] {
  const mk = (n: number, author: string, body: string, score: number) => ({
    id: buildId({
      source: post.source,
      instance: post.instance,
      kind: "comment" as const,
      nativeId: `${post.id}-c${n}`,
    }),
    dedupKey: dedupKey(`${post.dedupKey}-c${n}`),
    source: post.source,
    instance: post.instance,
    postId: post.id,
    author: {
      id: buildId({
        source: post.source,
        instance: post.instance,
        kind: "user" as const,
        nativeId: author,
      }),
      username: author,
      handle: post.source === "reddit" ? `u/${author}` : author,
    },
    body: text(body),
    createdAt: NOW - 20 * MIN * n,
    score,
    scoreHidden: false,
    userVote: Vote.None,
    saved: false,
    isOP: author === post.author.username,
    isStickied: false,
    distinguished: null,
    depth: 0,
    childCount: 0,
    permalinkRoute: post.permalinkRoute,
    ext: post.ext,
  });
  return [
    mk(
      1,
      post.author.username,
      "Obligatory OP comment with the backstory.",
      312,
    ),
    mk(2, "thread_regular", "Came here to say exactly this.", 87),
  ];
}

/** Minimal but honest SourceAdapter over the fixtures. */
class DemoAdapter implements SourceAdapter {
  readonly source: "reddit" | "lemmy";
  readonly instance: string;
  readonly account: AccountRef;
  readonly capabilities;
  private posts: Post[];

  constructor(source: "reddit" | "lemmy", instance: string, posts: Post[]) {
    this.source = source;
    this.instance = instance;
    this.posts = posts;
    this.capabilities =
      source === "reddit" ? REDDIT_CAPABILITIES : LEMMY_CAPABILITIES;
    this.account = {
      id: buildId({ source, instance, kind: "user", nativeId: "demo_reader" }),
      source,
      instance,
      username: "demo_reader",
      isGuest: false, // signed-in so the Subscribed feed pools this adapter
    };
  }

  async beginLogin(): Promise<LoginChallenge> {
    throw new Error("Demo mode has no login");
  }
  async completeLogin(_input: LoginInput): Promise<{
    account: AccountRef;
    secret: SecretBundle;
  }> {
    throw new Error("Demo mode has no login");
  }
  async restore(_secret: SecretBundle): Promise<AccountRef> {
    return this.account;
  }
  async logout(): Promise<void> {}

  async getFeed(_query: FeedQuery, _page: PageRequest): Promise<Page<Post>> {
    // Behave like a network. Instantly-resolved fixtures land in the same
    // breath as the feed list's first layout pass and race FlashList into a
    // phantom row gap real (latent) feeds never hit. ~150ms lets the list
    // mount empty first, exactly like production timing.
    await new Promise((r) => setTimeout(r, 150));
    return { items: this.posts };
  }
  async getPost(id: JanusId): Promise<Post> {
    const hit = this.posts.find((p) => p.id === id);
    if (!hit) throw new Error("Demo post not found");
    return hit;
  }
  async getComments(postId: JanusId): Promise<Page<Comment>> {
    const post = this.posts.find((p) => p.id === postId);
    return { items: post ? demoComments(post) : [] };
  }
  async loadMoreComments(): Promise<Comment[]> {
    return [];
  }

  async getCommunity(id: JanusId): Promise<Community> {
    const post = this.posts.find((p) => p.community.id === id);
    if (!post) throw new Error("Demo community not found");
    return {
      id,
      dedupKey: dedupKey(String(id)),
      source: this.source,
      instance: this.instance,
      name: post.community.name,
      handle: post.community.handle,
      subscriberCount: 12_400,
      subscription: "subscribed",
      isNSFW: false,
      isModerator: false,
      postingRestrictedToMods: false,
      permalinkRoute: post.permalinkRoute,
      ext: post.ext,
    };
  }
  async getSubscriptions(): Promise<Community[]> {
    const seen = new Set<string>();
    const out: Community[] = [];
    for (const p of this.posts) {
      if (seen.has(p.community.id)) continue;
      seen.add(p.community.id);
      out.push(await this.getCommunity(p.community.id));
    }
    return out;
  }
  async setSubscription(id: JanusId): Promise<Community> {
    return this.getCommunity(id);
  }
  async searchCommunities(): Promise<Page<Community>> {
    return emptyPage();
  }
  async getTrendingCommunities(): Promise<Community[]> {
    return [];
  }

  async vote(target: JanusId, vote: Vote): Promise<VoteResult> {
    const post = this.posts.find((p) => p.id === target);
    return { score: (post?.score ?? 0) + vote, userVote: vote };
  }
  async save(): Promise<void> {}
  async submitPost(_input: SubmitPostInput): Promise<Post> {
    throw new Error("Demo mode is read-only");
  }
  async submitComment(): Promise<Comment> {
    throw new Error("Demo mode is read-only");
  }
  async editContent(): Promise<Post | Comment> {
    throw new Error("Demo mode is read-only");
  }
  async deleteContent(): Promise<void> {
    throw new Error("Demo mode is read-only");
  }
  async uploadImage(_file: JanusFile): Promise<{ url: string }> {
    throw new Error("Demo mode is read-only");
  }

  async getUser(id: JanusId): Promise<User> {
    throw new Error(`Demo mode has no profiles (${id})`);
  }
  async getUserContent(
    _id: JanusId,
    _kind: UserContentKind,
  ): Promise<Page<Post | Comment>> {
    return emptyPage();
  }
  async blockUser(): Promise<void> {}

  async getUnreadCount(): Promise<number> {
    return 0;
  }
  async getInbox(): Promise<Page<Notification>> {
    return emptyPage();
  }
  async markRead(): Promise<void> {}
  async markAllRead(): Promise<void> {}
  async sendMessage(): Promise<void> {
    throw new Error("Demo mode is read-only");
  }
  async getConversations(): Promise<Page<Conversation>> {
    return emptyPage();
  }
  async getMessageThread(): Promise<Page<DirectMessage>> {
    return emptyPage();
  }

  async search(
    _q: string,
    _kind: SearchKind,
  ): Promise<Page<Post | Comment | Community | User>> {
    return emptyPage();
  }
  async resolveRemoteUrl(): Promise<ResolvedRemote> {
    throw new Error("Demo mode cannot resolve URLs");
  }
}

export function createDemoRedditAdapter(): SourceAdapter {
  return new DemoAdapter("reddit", "www.reddit.com", DEMO_REDDIT_POSTS);
}

export function createDemoLemmyAdapter(instance: string): SourceAdapter {
  return new DemoAdapter("lemmy", instance, DEMO_LEMMY_POSTS);
}

const DEMO_SHA = "demo0000rev";

/**
 * Stage the stateful feed features. Idempotent; runs before the tree mounts.
 */
export async function seedDemoState(): Promise<void> {
  // AI Lens: pretend a model install exists so feed chips read the cache,
  // and cache a "human" verdict for the megathread body.
  setPangramState({
    phase: "ready",
    sha: DEMO_SHA,
    numLabels: 4,
    labels: [
      "Human-written",
      "Lightly AI-edited",
      "Moderately AI-edited",
      "Fully AI-generated",
    ],
    dataBytes: MANIFEST?.dataTotalBytes,
  });
  // The opt-in human chip is the visible half of the verdict — show it.
  setAiLensPolicy({ showHuman: true });
  const cache = createMMKV({ id: "janus.aiLens.v1" });
  cache.set(
    textKey(MEGATHREAD_BODY, DEMO_SHA),
    JSON.stringify({
      index: 0,
      confidence: 0.94,
      probs: [0.94, 0.04, 0.01, 0.01],
      labels: [
        "Human-written",
        "Lightly AI-edited",
        "Moderately AI-edited",
        "Fully AI-generated",
      ],
    }),
  );

  // "+N new comments": record past visits with lower counts than the fixtures
  // carry now (+11 on the megathread, +164 on ProgrammerHumor, +54 on asklemmy).
  await initThreadVisits();
  const seedVisit = (post: Post, seenCount: number) =>
    recordVisit(
      {
        id: post.id,
        commentCount: seenCount,
        title: post.title,
        community: { handle: post.community.handle, id: post.community.id },
        source: post.source,
      },
      NOW - 1 * DAY,
    );
  seedVisit(DEMO_LEMMY_POSTS[0], DEMO_LEMMY_POSTS[0].commentCount - 11);
  seedVisit(DEMO_REDDIT_POSTS[1], DEMO_REDDIT_POSTS[1].commentCount - 164);
  seedVisit(DEMO_LEMMY_POSTS[2], DEMO_LEMMY_POSTS[2].commentCount - 54);
  await flushThreadVisits();
}
