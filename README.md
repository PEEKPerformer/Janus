# Janus

A unified iOS client for **Reddit** and **Lemmy** — one polished UI over two
sources. Two-faced god, two platforms.

Janus is built on a React Native / Expo shell (forked from Hydra) with a clean
**`SourceAdapter`** boundary: the entire UI renders a single source-agnostic
domain model, and each platform is just an adapter behind that interface.

> **Status:** working, well-tested **prototype**. Anonymous browsing of both
> Reddit and Lemmy through one UI: feeds, posts, threaded comments, media,
> capability-driven sorts, light/dark. Login/account write-actions are stubbed
> (the data layer raises typed `NotAuthenticatedError`s the UI handles
> gracefully) and are the next milestone.

## Architecture

```
janus/
├── core/                 # source-agnostic spine (no Reddit/Lemmy imports)
│   ├── ids.ts            # JanusId codec: canonical id vs federation dedupKey (ap_id)
│   ├── model.ts          # unified Post/Comment/Community/User/Notification/MediaItem
│   ├── adapter.ts        # the SourceAdapter interface every backend implements
│   ├── capabilities.ts   # per-source feature flags (UI gates on these, no faked parity)
│   ├── comment-tree.ts   # one flat↔tree builder + virtualization flatten (both sources)
│   ├── pagination.ts     # opaque cursor (Reddit `after` + Lemmy PageCursor)
│   ├── vote.ts  errors.ts
├── sources/
│   ├── reddit/           # RedditAdapter over the web .json API (engineered transport:
│   │                     #   rate-limit, backoff, Retry-After, typed errors)
│   └── lemmy/            # LemmyAdapter over the Lemmy v3 REST API (federation-aware)
├── ui/                   # the unified UI: theme, AdapterContext, hooks, components, screens
└── entry.tsx             # app entry (builds adapters, mounts the UI)
```

The core thesis is proven end-to-end: Reddit's nested comments and Lemmy's
`path`-based comments flow through the **same** `buildCommentTree`, and both
feeds render through the same `PostCard`.

## Run

```sh
npm install
# Xcode is required. If `xcode-select -p` points at CommandLineTools, prefix with DEVELOPER_DIR.
SENTRY_DISABLE_AUTO_UPLOAD=true DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx expo run:ios
```

## Test

```sh
npm test          # 90+ unit/component tests (jest + @testing-library/react-native)
npm run tsc       # strict type-check
```

Tests cover the ID codec, comment-tree (incl. cycle guards), both adapters'
mappers + endpoints (against fixtures), the engineered transport's
backoff/retry/concurrency, the pagination hooks, and every UI component +
screen (rendering, interactions, loading/empty/error states).

## Known constraints (prototype)

- **Reddit is IP-blocked from datacenter networks.** Reddit's `.json` endpoints
  work from a real device's residential IP but return a block page to cloud
  IPs, so in a CI/sandbox the Reddit feed shows a graceful error state. Lemmy
  works anywhere. (This is inherent to the no-API-key web approach.)
- **Anonymous only.** Voting/posting/subscribing raise a typed
  `NotAuthenticatedError` surfaced as a "Sign in to vote" prompt. Multi-account
  login (Reddit is single-active-account per the cookie-jar constraint; Lemmy
  uses per-request JWTs) is the next milestone.
- Deferred enhancements: deep comment "load more" splicing, full-screen image /
  gallery pager, comment-sort & time-window pickers, push notifications.

## License

Built on AGPL-3.0 sources (Hydra, Voyager). Personal, unreleased project.
