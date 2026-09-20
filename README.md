# Listening Room

A demo site that turns a competitive social-listening export into something you can walk a client through: six female hair-removal brands (Venus, Philips OneBlade Intimate, Estrid, Veet, Wilkinson Sword, Mercadona), what creators posted about them across TikTok, Instagram and YouTube from October 2025 to August 2026, what audiences said back in the comments, and what a brand should ask those people next.

## Views

- **Category** – earned media value ranking, post-level sentiment, weekly creator activity as small multiples, and the one-line diagnosis for each brand.
- **Brand** – headline metrics, platform and tier mix, the Assess / Anticipate / Act read per platform, twelve comment-listening dimensions with verbatim quotes, and (for Estrid) a table of top creator posts.
- **Compare** – signal density across brands, who gets named in whose comments, objection categories, and intent-vs-friction.
- **Ask them next** – a deterministic outbound voice-survey script built from each brand's own comment evidence, with the signal behind every question. This is the bridge from listening to a New Voices style conversation.

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

Vite + React + Tailwind + Recharts, no server. Deploys to Vercel as a static site; `vercel.json` rewrites all paths to `index.html`.
