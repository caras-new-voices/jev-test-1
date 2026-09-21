# Build spec: "Real EMV" + disclosure audit

A new view for Listening Room that re-bases the report's headline number —
earned media value — on whether each creator post is actually *about* the
brand's product, and audits paid-partnership disclosure. Both are computed by
running Jev (TypeSafe AI's System One model) once over all 6,168 creator posts
and committing the per-post scores as data.

Read this whole file before touching anything. Then read `README.md`,
`api/evaluate.ts`, `src/lib/jev.ts`, `src/components/Overview.tsx`,
`src/components/CorpusSweep.tsx` and `src/components/ui.tsx` — the new work must
look and behave like what is already there.

## Why this exists

- The category Overview ranks six brands by EMV: Venus $6.5M, OneBlade $3.0M,
  Estrid $2.2M, Veet $0.8M, Wilkinson $0.5M, Mercadona $0.05M. That number
  counts every post the Brandwatch query matched, including a $35,527 "let's
  stock up on body care essentials" haul that tags `@heyestrid` as one brand
  among four. In a random sample of 90 posts, **42% were not substantively
  about the product and carried 67% of the EMV**; for Estrid ~99%.
- The export has `relevant`, `relevance_confidence` and `relevance_reason`
  columns — **empty on every row**. Nobody filled the slot. Jev fills it.
- Brandwatch's `is_paid` flag marks 155 of 6,168 posts paid. Jev found 17% of a
  sample disclosed vs 7% flagged, including German "Anzeige", Swedish
  "Reklam/pr" and English "AD |" posts flagged *unpaid* — and posts flagged
  paid with no disclosure at all. Disclosure exposure sits with the brand.
- Brandwatch's `language` is "unknown" for 3,930 posts (64%), which makes
  per-market reporting impossible. Jev's language answer fixes it.

## Inputs (already on disk, git-ignored)

`data/raw/posts.csv` — 6,168 rows, one per post/segment link. Columns used:

| column | meaning |
| --- | --- |
| `segment_id`, `segment_name` | brand id (474 Estrid, 478 Veet, 485 Mercadona, 520 Venus, 522 Philips OneBlade Intimate (Female), 523 Wilkinson Sword (Female)) |
| `post_id`, `username`, `platform`, `url`, `text`, `publishedAt` | the post. `publishedAt` is `YYYY-MM-DD HH:MM:SS.000`; keep the date part |
| `computed_stats` | JSON: `emv`, `tier`, `country`, `is_paid`, `language`, `followers`, `sentiment`, `like_count`, `comment_count`, `view_count` |

Quoted fields contain newlines — use Python's `csv` module with
`csv.field_size_limit(1 << 30)`. Nine captions are empty; score them anyway
(they will come back as unrelated).

`data/raw/` is git-ignored and must stay that way. Never commit it.

## Step 1 — the scorer: `scripts/score_posts.py`

Python 3 stdlib only (`csv`, `json`, `urllib.request`, `ssl`, `time`,
`argparse`). No pip installs.

It calls the deployed endpoint, **not** the gateway directly, so no key is
needed anywhere: `POST https://jev-test-1.vercel.app/api/evaluate` with a
custom `questions` set (the endpoint validates: ≤6 questions, ≤400-char
instructions, ≤12 choice options). Override with `--endpoint`. Outbound HTTPS
in this sandbox goes through a proxy whose CA is at
`/root/.ccr/ca-bundle.crt`; `ssl.create_default_context()` honours the
`SSL_CERT_FILE` env var already set, but pass
`cafile=os.environ.get('SSL_CERT_FILE')` explicitly to be safe. Never disable
verification.

### The state sent per post

Send `text` (the endpoint caps it at 1,200 characters) shaped like:

```
Brand: Estrid
Platform: tiktok
Caption: <caption, trimmed>
```

Naming the brand matters: the questions say "the brand's product".

### The six questions (exactly these; wording is tested)

```json
{
  "aboutProduct": {
    "type": "boolean",
    "instructions": "This is the caption of a creator post captured by a social-listening query for the named female hair-removal brand. Is the post substantively about that brand's hair-removal product, rather than an unrelated post that merely tags or mentions it in passing?"
  },
  "prominence": {
    "type": "score",
    "instructions": "How central is the named brand's hair-removal product to this post?",
    "criteria": ["Not really present or unrelated", "One tag or mention among many", "Featured alongside other products", "The main subject of the post"]
  },
  "disclosed": {
    "type": "boolean",
    "instructions": "Does the caption disclose, in any language, that this is a paid, sponsored, gifted or affiliate partnership (e.g. #ad, AD |, Werbung, Anzeige, annons, reklam, paid partnership, gifted, PR sample, discount code, affiliate link)?"
  },
  "format": {
    "type": "choice",
    "instructions": "What kind of post is this?",
    "criteria": {
      "review": "Personal review or honest opinion of the product",
      "tutorial": "How-to, routine or demonstration",
      "haul": "Haul, shopping trip, or get-ready-with-me featuring many products",
      "promo": "Promotional post with a discount code, link or launch announcement",
      "giveaway": "Giveaway or contest",
      "unrelated": "Not really about the product at all"
    }
  },
  "claim": {
    "type": "choice",
    "instructions": "Which product claim does the caption lean on most?",
    "criteria": {
      "smooth": "Smooth or close result",
      "skin": "Gentle, no irritation, sensitive skin",
      "value": "Price, value, deal",
      "design": "Design, colours, aesthetics",
      "convenience": "Speed, ease, subscription, travel",
      "none": "No product claim made"
    }
  },
  "language": {
    "type": "choice",
    "instructions": "What language is the caption written in? Ignore hashtags and @handles.",
    "criteria": { "en": "English", "de": "German", "fr": "French", "it": "Italian", "es": "Spanish", "pl": "Polish", "nl": "Dutch", "sv": "Swedish", "cs": "Czech", "ro": "Romanian", "other": "Some other language" }
  }
}
```

### Behaviour

- **Resumable.** Append one JSON line per scored post to
  `data/raw/post_scores.jsonl` (`post_id`, the six answers verbatim,
  `latencyMs`, `costUsd`, `scoredAt`). On start, read the file and skip posts
  already present. Running it twice must not double-score.
- **Throttle-aware.** The provider behind the gateway returns `429` under
  sustained load ("high demand"), and the Edge function returns `504` if the
  provider holds a request past 15 s. Both are retryable. Use a small worker
  pool (start 2, max 4) with a **shared** cooldown: on any 429, pause *all*
  workers for `min(20s, 0.8s·2^n)` where `n` is consecutive throttles, reset
  on success; retry the post. Retry 502/504 with a short backoff without
  reducing concurrency. Give up on a post after 12 attempts and record it in
  `data/raw/post_scores.failed.jsonl`; a later run picks failed posts up
  again. Expect roughly 1–2 posts/second overall; the full run is **an hour
  or two**. That is fine.
- **Observable.** Print a progress line every 25 posts: done/total, rate,
  throttles, spend so far, ETA. `--limit N` scores only the first N unscored
  posts (use `--limit 30` first and read the answers before launching the full
  run). `--dry-run` prints the state for three posts and exits.
- Handle Ctrl-C / SIGTERM cleanly (flush the JSONL).

### Step 1b — the aggregator: `python3 scripts/score_posts.py --build`

Reads `posts.csv` + `post_scores.jsonl`, writes **`src/data/posts_scored.json`**
(committed; `ensure_ascii=False`, compact separators). Shape:

```json
{
  "generatedAt": "2026-09-21T…Z",
  "model": "typesafe-ai/jev",
  "coverage": { "posts": 6168, "scored": 6168, "failed": 0 },
  "spend": { "costUsd": 0.23, "modelMs": 1610000, "wallSeconds": 5400 },
  "questions": { …the six questions verbatim, so the UI can show them… },
  "posts": [
    {
      "id": "82881997", "brandId": 474, "platform": "tiktok", "date": "2026-07-24",
      "username": "cherriecherry_", "url": "https://…", "country": "United Kingdom",
      "tier": "macro", "followers": 485800, "emv": 15799.3, "paidFlag": false,
      "bwLanguage": "unknown", "snippet": "first 140 chars of caption, whitespace collapsed",
      "about": 0.07, "prom": 0.3, "disclosed": 0.05,
      "format": "haul", "formatP": 0.91, "claim": "none", "lang": "en", "langP": 0.99
    }
  ]
}
```

Round probabilities to 2 dp and scores to 2 dp. No full captions in the
committed file — `snippet` only. Expect ~1.5 MB; it is lazy-loaded (see
Step 3) so bundle size is unaffected.

Also print a sanity report to stdout when building: coverage; overall and
per-brand share of posts with `about < 0.5` and the share of EMV they carry;
the 2×2 disclosure matrix (Jev disclosed ≥0.5 × Brandwatch `paidFlag`);
Brandwatch-unknown languages resolved by Jev. Paste that report into the
commit message body.

## Step 2 — the definitions (use these exact words in the UI)

- **Reported EMV** — the export's `emv`, summed. What the Overview shows today.
- **Real EMV (strict)** — EMV of posts where `about ≥ 0.5`. *"Earned by posts
  that are actually about the product."* This is the default.
- **Real EMV (weighted)** — `Σ emv × prom / 3`. *"Each post counts in
  proportion to how central the product is."* Offered as a toggle.
- **Off-topic** — `about < 0.5`. **Passing mention** — `prom < 1.5`.
- **Disclosed** — `disclosed ≥ 0.5`. **Flagged** — Brandwatch `paidFlag`.
  The four cells: disclosed & flagged · disclosed but unflagged ·
  **flagged but undisclosed** (the exposure) · neither.
- **Uncertain** — `0.35 ≤ about ≤ 0.65`. Always show how many posts are
  uncertain; never hide it.

## Step 3 — the view: `src/components/RealEmv.tsx`, route `#/real-emv`

Add `{ key: 'real', label: 'Real EMV', hash: '#/real-emv' }` to the nav in
`src/App.tsx` after "Compare", plus the `Route` union member and render line,
following exactly how the other routes are wired. Do not touch other views.

Load the data lazily the way `src/lib/data.ts` loads posts:
`import.meta.glob('../data/posts_scored.json', { import: 'default' })` behind
a `loadScoredPosts()` helper added to `data.ts`, with types added to
`src/lib/types.ts`. Show the existing pulse placeholder
(`<div className="h-64 animate-pulse rounded-xl bg-surface-2" />`) while it loads.

Use only the primitives in `ui.tsx` (`Card`, `SectionTitle`, `StatTile`,
`Pill`, `Quote`, `BrandChip`, `Legend`, `ChartTooltip`, `Num`), brand colours
via `brandSlot(id)`, names via `shortName`, Recharts as `Overview.tsx` uses
it, and the CSS tokens (`text-ink`, `text-ink-2`, `text-muted`, `bg-surface`,
`bg-surface-2`, `border-border`, `var(--accent)`, `var(--axis)`). Everything
must work in light and dark. All copy in English.

Sections, top to bottom:

1. **Headline card.** Title "Real EMV". Sub: one sentence saying what was done
   ("Every one of the 6,168 creator posts behind this report was asked six
   questions by Jev. This page re-bases the headline number on the answers.").
   Four `StatTile`s: Reported EMV · Real EMV (strict) with % retained as hint ·
   Off-topic posts (count and % of posts, hint "carrying $X of EMV") ·
   Flagged-but-undisclosed posts. Right slot: `Pill` "computed offline ·
   {coverage.scored} posts · ${spend} · {date}".

2. **Reported vs Real by brand.** Horizontal bar chart, one row per brand in
   `BRAND_ORDER`, two bars: reported (use `var(--neutral-fill)` or a muted
   fill) and real (brand colour via `brandSlot`). Label each row with %
   retained. A toggle (segmented buttons like the theme switcher) between
   *strict* and *weighted*. Sub-copy states the definition in use. Note
   whether the *ranking* changed; if it did, say so in one sentence
   generated from the data (e.g. "On real EMV, OneBlade overtakes Venus").

3. **By month.** Small multiples (one per brand, six panels, as Overview does
   weekly) with two lines: reported and real, monthly from Oct 2025 to Jul 2026
   (drop Aug 2026, three posts). Shared y-axis scale off by default; a
   checkbox "same scale" like a careful analyst would want.

4. **Where the money actually went.** Stacked horizontal bars per brand of EMV
   by `format` (review, tutorial, haul, promo, giveaway, unrelated). Sequential
   neutral fills from the existing palette, `unrelated` in `var(--muted)`.
   Legend via `Legend`.

5. **The biggest off-topic posts.** Table, top 25 by EMV where `about < 0.5`:
   brand swatch, creator (link to `url`, `target="_blank" rel="noreferrer"`),
   platform, date, EMV (`Num`), about %, prominence, snippet. Brand filter
   chips (`BrandChip`) above; "All" default.

6. **Disclosure audit.** Per brand, the 2×2 as four small `StatTile`s or a
   compact table; then a list (top 30 by EMV) with a segmented filter:
   *flagged but undisclosed* (default) · *disclosed but unflagged* · *both* ·
   plus a country filter (top countries as chips). Each row: creator with
   link, brand, country, date, EMV, disclosed %, `Pill` for the Brandwatch
   flag. One sentence of copy explaining that disclosure obligations sit
   with the brand as well as the creator, and that the list is a starting
   point for a human check, not a verdict.

7. **Markets Brandwatch couldn't see.** Two stacked bars: Brandwatch language
   field vs Jev language, for the same posts, showing "unknown" collapsing.
   Then EMV by Jev language per brand (small table). Copy: "64% of posts had
   no language in the export."

8. **Method and caveats** (last card). How it was computed (the six questions
   — render them from `questions` in the JSON as a definition list), the
   thresholds above, coverage, spend, model time, wall time, the uncertain
   count with its definition, and three honest caveats: (a) captions only —
   the video itself is not seen, so a product that is shown but not captioned
   scores low; (b) `prom` and `about` are model judgements with the confidence
   shown, not ground truth; (c) EMV is heavy-tailed, so a handful of posts move
   the totals — which is exactly why the table in section 5 exists. Link to
   `scripts/score_posts.py` by path.

Also: on the **Overview** page's EMV chart card, add one line of sub-copy
under the existing subtitle: "Counts every matched post. See Real EMV for the
share that is actually about the product." with `Real EMV` as a button that
navigates to `#/real-emv`. Nothing else on Overview changes.

## Step 4 — verify before you commit

- `npm run build` — `tsc --noEmit` and Vite must both be clean (the project
  uses `noUnusedLocals`/`noUnusedParameters`; don't leave dead imports).
- `npx vite preview --port 4181` then drive the page with Playwright:
  `playwright-core` is installed at
  `/tmp/claude-0/-home-user-jev-test-1/4aa37da5-cd7c-57d6-8f33-423b05249ef0/scratchpad/node_modules`
  and Chromium at `/opt/pw-browsers/chromium` (launch with
  `executablePath: '/opt/pw-browsers/chromium'`). Check: every section renders,
  the strict/weighted toggle changes numbers, brand filter works, no console
  errors, and the four headline tiles match the sanity report the aggregator
  printed. Take a full-page screenshot and look at it in both themes (set
  `document.documentElement.dataset.theme = 'dark'`).
- Sanity-check the data by hand: open `posts_scored.json`, find the
  `$35,527` Estrid "stock up on body care essentials" post and confirm
  `about` is low and `format` is `haul`; find an "Anzeige"/"AD |" post and
  confirm `disclosed` is high; confirm the six brands' reported EMV totals
  match `category.json` metrics to within rounding.

## Step 5 — commit and push

Branch: `claude/youthful-thompson-5438bw` (already checked out; push with
`git push -u origin claude/youthful-thompson-5438bw`). Commit in two steps if
the run is long: (1) the scorer script alone once `--limit 30` looks right,
(2) the data file, aggregator output and view together when the full run has
finished. Commit messages: what and why, wrap at 72, include the sanity
report in the body of (2). Never commit anything under `data/raw/`, `.env*`,
or any key. End every commit message with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013owJQPsH8KkARM3yecRpZZ
```

Update `README.md`: a **Real EMV** bullet under Views, a short section under
the Jev integration explaining the offline pass (`npm run score` →
`scripts/score_posts.py`; `--build` step; that `posts_scored.json` is
committed and how to refresh it), and add `"score": "python3 scripts/score_posts.py"`
to `package.json` scripts.

## Hard rules

- No new npm dependencies. No Python packages beyond stdlib.
- No keys, tokens or credentials in any file, log, or commit — the scorer
  needs none because it calls the deployed endpoint.
- Do not run `scripts/build_data.py`; do not modify `src/data/` except to add
  `posts_scored.json`.
- Do not redesign existing views. Match their look exactly.
- Do not chain `sleep`s in shell to wait; run the long scorer with
  `run_in_background` / `nohup` and poll `wc -l data/raw/post_scores.jsonl`
  with an `until` loop.
- If the provider throttles so hard the full run would exceed ~3 hours, stop
  at a clean point, commit what you have with `coverage` reflecting the
  partial run, make the view label itself "partial: N of 6,168 scored", and
  say so in your final report — do not fabricate or interpolate scores.
- Report faithfully: what ran, what numbers came out, what you verified in the
  browser, what you did not get to.
