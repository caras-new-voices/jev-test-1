# Listening Room

A demo site that turns a competitive social-listening export into something you can walk a client through: six female hair-removal brands (Venus, Philips OneBlade Intimate, Estrid, Veet, Wilkinson Sword, Mercadona), what creators posted about them across TikTok, Instagram and YouTube from October 2025 to August 2026, what audiences said back in the comments, and what a brand should ask those people next.

## Views

- **Category** – earned media value ranking, post-level sentiment, weekly creator activity as small multiples, and the one-line diagnosis for each brand.
- **Brand** – headline metrics, platform and tier mix, the Assess / Anticipate / Act read per platform, twelve comment-listening dimensions with verbatim quotes, and (for Estrid) a table of top creator posts.
- **Compare** – signal density across brands, who gets named in whose comments, objection categories, and intent-vs-friction.
- **Ask them next** – a deterministic outbound voice-survey script built from each brand's own comment evidence, with the signal behind every question. This is the bridge from listening to a New Voices style conversation.
- **Live triage** – the only view that calls a model at view time. Classifies any comment you give it through [Jev](https://vercel.com/ai-gateway/models/jev), TypeSafe AI's System One model. See below.

## Jev integration

Every other view reads pre-built JSON. The twelve listening dimensions were assigned **offline, in a batch, by a generative LLM** (the `model` field in `src/data/brands/*.comments.json` records which). That is the right tool for writing a synthesis and the wrong one for judging a single comment on demand: it bills per generated token and answers in seconds.

Jev is a *System One* model — it emits no text at all. You give it some state and a set of typed questions, and it returns a decision per question plus the probability it assigned to every option. It has three primitives:

| Primitive | Shape | Returns |
| --- | --- | --- |
| `choice` | up to 255 named options | the winner, a probability per option, a confidence |
| `boolean` | optional true/false descriptions | probability that the statement is true |
| `score` | 2–10 ordered rungs | an interpolated score + per-rung probabilities |

Questions of different types share one piece of state and are answered in a single round trip. The view ships four **packs**, each asking four questions at once — all four verified against the live API:

- **Comment triage** – the twelve dimensions as a `choice`, plus spam, call-worthiness and urgency. Directly comparable to the offline pass, so the view flags agreement or divergence.
- **Route and act** – which team owns it, reply publicly or not, what the reply should do first, queue priority.
- **Voice-survey screener** – is this a useful interview respondent, which scripted question to open with, how likely they actually bought, how candid they are.
- **Language and data quality** – what language, is it English, is it on topic, is it spam.

There is also a **custom question builder**: the visitor writes any `choice`, `boolean` or `score` they like. `api/evaluate.ts` validates it (≤5 questions, ≤12 options, ≤300 characters of instructions, ≤10 score rungs) and still pins the model, so the endpoint never becomes a general-purpose relay. Because Jev cannot emit free text, the answer always lands in the declared shape.

Observed on this corpus: roughly 120–200 ms model-side, ~0.5–0.9 s end to end through the gateway, and $0.00002–$0.00004 per four-question request. Every response carries its own token usage and cost, which the UI prints above the results rather than asking you to take its word.

### How it is wired

```
browser  ──POST { text, pack }──▶  /api/evaluate  ──POST──▶  ai-gateway.vercel.sh/v1/evaluate
                                   Vercel Edge Function       model: typesafe-ai/jev
                                   reads AI_GATEWAY_API_KEY
```

- `api/evaluate.ts` is the only server-side code in the project. It reads `AI_GATEWAY_API_KEY` from the environment and **pins the model id**; the browser sends the comment text plus either a pack name or a question set that has to survive validation. A `GET` on the same path returns the packs and limits, so you can see exactly what the server will ask.
- It runs on the **Edge** runtime deliberately. Vercel's Node builder treats a default export as a classic `(req, res)` handler and waits for `res.end()`, so returning a web `Response` there hangs the request until the gateway times out.
- The key is **never** committed and never reaches the browser. Set it in Vercel → Project → Settings → Environment Variables, then redeploy.
- `vercel.json` rewrites everything to `index.html` *except* `/api/*`, so the function is reachable.

### Running the live view locally

`npm run dev` and `npm run preview` serve the static site only — `/api/evaluate` does not exist under either, and the view will say so. To exercise it locally you need the Vercel runtime:

```
npm i -g vercel
vercel link
vercel env pull            # writes .env.local with AI_GATEWAY_API_KEY
vercel dev
```

An AI Gateway key looks like `vck_…`; you can also get a TypeSafe key directly from `console.typesafe.ai` and point the function at `api.typesafe.ai/v1/systemone` instead, which takes TypeSafe's own request shape.

## Data

Raw exports are not committed (`data/raw/` is git-ignored). To rebuild the compact JSON under `src/data/`:

```
mkdir -p data/raw
# copy the exports in:
#   data/raw/segments.csv   brandwatch_query_segments_*.csv
#   data/raw/posts.csv      _2_Influencer_posts_one_row_per_post_segment_link_*.csv (optional)
npm run data
```

The committed `src/data/` was built from the segments export plus a 600-post sample of the Estrid segment. Drop in the full posts export and re-run `npm run data` to get post tables for every brand.

## Develop and deploy

```
npm install
npm run dev      # local
npm run build    # static output in dist/
```

Vite + React + Tailwind + Recharts. Deploys to Vercel; `vercel.json` rewrites all paths to `index.html` except `/api/*`, which is served by the one Vercel Function (`api/evaluate.ts`). The only environment variable is `AI_GATEWAY_API_KEY` — see `.env.example`. Without it the site still builds and every view works except Live triage, which reports that the key is missing.
