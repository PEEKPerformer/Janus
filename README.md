<p align="center">
  <img src="assets/images/icon.png" alt="Janus app icon" width="104">
</p>

<h1 align="center">Janus</h1>

A unified iOS client for **Reddit** and **Lemmy** — one polished UI over two
networks. Two-faced god, two platforms.

Janus is a React Native / Expo app built around a single **`SourceAdapter`**
boundary: the entire UI renders one source-agnostic domain model, and each
network is just an adapter behind that interface. The payoff is the things no
single-network app can do — a genuinely merged feed, and reading the same
conversation across both networks at once.

<p align="center">
  <img src="docs/feed.png" alt="Janus feed — Reddit and Lemmy merged into one source-tagged feed, with cross-network repost collapse" width="320">
</p>

> The feed interleaves Reddit and Lemmy, tags each post with its origin, and
> folds the same content posted across networks into one card (“Also in 2
> communities”). *(Posts above are illustrative.)*

## Highlights

**Unified, not bolted-together**
- One feed interleaves your Reddit subscriptions and Lemmy communities, with a
  source-balance preference; source is a quiet sigil on each card, not a tribe.
- One model, one composer, one comment renderer: Reddit's nested comments and
  Lemmy's `path`-based comments flow through the **same** tree builder, and both
  feeds render through the same `PostCard`.

**Cross-network features (only possible spanning both)**
- **Repost collapse** — the same link/image posted to several communities across
  both networks folds into one card that carries its companion discussions.
- **Community twins** — standing on `r/technology`, a verified pointer to
  `technology@lemmy.world` (and vice-versa), from a curated map.
- **Merged discussions** — every community's thread about the same content in one
  source-tagged, filterable view.

**Full participation**
- Multi-account: one Reddit account alongside several Lemmy instances at once.
- Vote, comment, post (with drafts + flair), save, subscribe, report, and
  moderate — all routed to the right network per entity.

**Power-user reading**
- **New-comment highlighting** — revisit a thread and everything posted since
  your last visit is badged NEW, with a jump button and a "+N" badge on the
  feed card. Works on Reddit *and* Lemmy threads.
- **User tags** — RES-style private labels ("GPU expert") pinned to any
  handle on either network, shown wherever they appear. Long-press a username.
- **Find in thread** — ⌘F for comments: live match count, next/prev jumps.
- **History** — every thread you've opened, searchable, reopenable on any
  network or instance.

**Reading & media**
- Threaded comments with collapse, load-more, per-community sort memory, and
  jump-to-next-comment.
- Native image/gallery viewer, inline video/GIF, and a TikTok-style media reel.
- Community sidebars (about/rules) and a native wiki viewer.

**Make it yours**
- Custom accent + true-black OLED theming, configurable swipe actions, density,
  hide-seen/hide-NSFW, keyword/community/user filters, iPad split view.

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
│   └── vote.ts  errors.ts
├── sources/
│   ├── reddit/           # RedditAdapter over the web .json API (engineered transport:
│   │                     #   rate-limit, backoff, Retry-After, typed errors)
│   └── lemmy/            # LemmyAdapter over the Lemmy v3 REST API (federation-aware)
├── app/                  # device-local stores (settings, accounts, caches, prefs)
├── ui/                   # the unified UI: theme, AdapterContext, hooks, components, screens
└── entry.tsx             # app entry (builds adapters, mounts the UI)
```

The UI never imports a Reddit or Lemmy client directly — only `SourceAdapter`.
Capabilities are declared honestly, so the UI hides controls a source can't back
rather than faking parity.

## Getting started

```sh
npm install
# Xcode is required. If `xcode-select -p` points at CommandLineTools, prefix with DEVELOPER_DIR.
npx expo run:ios
```

## Develop

```sh
npm test       # jest + @testing-library/react-native
npm run tsc    # strict type-check
npm run lint   # eslint
```

The test suite (400+ tests) covers the ID codec, the comment-tree builder
(including cycle guards), both adapters' mappers and endpoints against fixtures,
the engineered transport's backoff/retry, pagination and cache hooks, the
cross-network engine (twins, repost collapse, deep-link parsing), and UI
components/screens.

## License

Janus is licensed under the **GNU AGPL-3.0** (see [`LICENSE`](LICENSE)). It
derives from AGPL-3.0 projects — [Hydra](https://github.com/dmilin1/hydra) and
[Voyager](https://github.com/aeharding/voyager) — and stays under the same
license.
