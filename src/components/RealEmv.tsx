import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BRAND_ORDER, brandSlot, category, loadScoredPosts, shortName } from '../lib/data'
import type { ScoredPost, ScoredPostsFile } from '../lib/types'
import { compact, money } from '../lib/format'
import { BrandChip, Card, ChartTooltip, Legend, Num, Pill, SectionTitle, StatTile, Swatch } from './ui'

/**
 * Real EMV — the report's headline number, re-based on whether each post is
 * actually about the product.
 *
 * Everything here is read from `src/data/posts_scored.json`, which was written
 * once by `scripts/score_posts.py`: six typed questions per post, 6,168 posts,
 * answered offline by Jev. No model is called at view time; the file is lazy so
 * it costs the rest of the site nothing.
 */

/* ------------------------------------------------------------ definitions */

/** Off-topic. A post Jev does not think is substantively about the product. */
const OFF_TOPIC = 0.5
/** Disclosed. The caption says, in some language, that this is a partnership. */
const DISCLOSED = 0.5
/** Uncertain. Neither Jev nor a careful reader would call this one. */
const UNCERTAIN: [number, number] = [0.35, 0.65]

type Mode = 'strict' | 'weighted'

const MODE_COPY: Record<Mode, { label: string; definition: string }> = {
  strict: { label: 'Strict', definition: 'Real EMV (strict) is the EMV of posts where about ≥ 0.5 — earned by posts that are actually about the product.' },
  weighted: { label: 'Weighted', definition: 'Real EMV (weighted) is Σ emv × prom / 3 — each post counts in proportion to how central the product is.' },
}

const realEmv = (p: ScoredPost, mode: Mode) => (mode === 'strict' ? (p.about >= OFF_TOPIC ? p.emv : 0) : (p.emv * p.prom) / 3)

const FORMATS = ['review', 'tutorial', 'haul', 'promo', 'giveaway', 'unrelated'] as const
const FORMAT_LABEL: Record<string, string> = {
  review: 'Review',
  tutorial: 'Tutorial',
  haul: 'Haul / GRWM',
  promo: 'Promo',
  giveaway: 'Giveaway',
  unrelated: 'Unrelated',
}
/** A sequential ramp off the one accent in the palette; `unrelated` steps out of it. */
const FORMAT_FILL: Record<string, string> = {
  review: 'color-mix(in oklab, var(--accent) 100%, var(--surface-2))',
  tutorial: 'color-mix(in oklab, var(--accent) 78%, var(--surface-2))',
  haul: 'color-mix(in oklab, var(--accent) 58%, var(--surface-2))',
  promo: 'color-mix(in oklab, var(--accent) 40%, var(--surface-2))',
  giveaway: 'color-mix(in oklab, var(--accent) 24%, var(--surface-2))',
  unrelated: 'var(--muted)',
}

const LANG_LABEL: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  pl: 'Polish',
  nl: 'Dutch',
  sv: 'Swedish',
  cs: 'Czech',
  ro: 'Romanian',
  other: 'Other',
  unknown: 'unknown',
}
const LANG_ORDER = ['en', 'de', 'it', 'fr', 'es', 'pl', 'cs', 'nl', 'sv', 'ro', 'other', 'unknown']
const langFill = (key: string, i: number) =>
  key === 'unknown' ? 'var(--muted)' : `color-mix(in oklab, var(--accent) ${Math.max(18, 100 - i * 8)}%, var(--surface-2))`

const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

const share = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–')
const probPct = (p: number) => `${Math.round(p * 100)}%`
const brandName = (id: number) => shortName(category.brands.find((b) => b.id === id)?.name ?? String(id))
const sum = (rows: ScoredPost[], f: (p: ScoredPost) => number) => rows.reduce((a, p) => a + f(p), 0)

const segButton = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-xs transition ${active ? 'bg-ink text-page' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`
const chipButton = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${active ? 'border-ink bg-ink text-page' : 'border-border bg-surface text-ink hover:bg-surface-2'}`

/* ------------------------------------------------------------------- view */

export default function RealEmv() {
  const [data, setData] = useState<ScoredPostsFile | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    loadScoredPosts()
      .then((d) => {
        if (!live) return
        if (d) setData(d)
        else setMissing(true)
      })
      .catch(() => live && setMissing(true))
    return () => {
      live = false
    }
  }, [])

  if (missing) {
    return (
      <Card>
        <SectionTitle title="Real EMV" sub="src/data/posts_scored.json is not in this build. Run `npm run score` and then `python3 scripts/score_posts.py --build`." />
      </Card>
    )
  }
  if (!data) return <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
  return <RealEmvBody data={data} />
}

function RealEmvBody({ data }: { data: ScoredPostsFile }) {
  const posts = data.posts
  const [mode, setMode] = useState<Mode>('strict')

  const reported = useMemo(() => sum(posts, (p) => p.emv), [posts])
  const strict = useMemo(() => sum(posts, (p) => realEmv(p, 'strict')), [posts])
  const offTopic = useMemo(() => posts.filter((p) => p.about < OFF_TOPIC), [posts])
  const offEmv = useMemo(() => sum(offTopic, (p) => p.emv), [offTopic])
  const uncertain = useMemo(() => posts.filter((p) => p.about >= UNCERTAIN[0] && p.about <= UNCERTAIN[1]), [posts])
  const exposure = useMemo(() => posts.filter((p) => p.paidFlag && p.disclosed < DISCLOSED), [posts])
  const partial = data.coverage.scored < data.coverage.posts

  const sub = partial
    ? `${data.coverage.scored.toLocaleString('en-GB')} of the ${data.coverage.posts.toLocaleString('en-GB')} creator posts behind this report have been asked six questions by Jev — an even sample of all six brands, not the first N of the export. This page re-bases the headline number on the answers, over those posts only.`
    : `Every one of the ${data.coverage.posts.toLocaleString('en-GB')} creator posts behind this report was asked six questions by Jev. This page re-bases the headline number on the answers.`

  return (
    <div className="grid gap-4">
      <Card>
        <SectionTitle
          title="Real EMV"
          sub={sub}
          right={
            <div className="flex flex-wrap items-center gap-2">
              {partial && <Pill tone="bad">partial: {data.coverage.scored.toLocaleString('en-GB')} of {data.coverage.posts.toLocaleString('en-GB')} scored</Pill>}
              <Pill tone="accent">
                computed offline · {data.coverage.scored.toLocaleString('en-GB')} posts · ${data.spend.costUsd.toFixed(2)} ·{' '}
                {data.generatedAt.slice(0, 10)}
              </Pill>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Reported EMV" value={money(reported)} hint={partial ? `the ${data.coverage.scored.toLocaleString('en-GB')} scored posts` : 'every post the query matched'} />
          <StatTile label="Real EMV (strict)" value={money(strict)} hint={`${share(strict, reported)} of reported retained`} />
          <StatTile
            label="Off-topic posts"
            value={compact(offTopic.length, 1)}
            hint={`${share(offTopic.length, posts.length)} of posts · carrying ${money(offEmv)} of EMV`}
          />
          <StatTile
            label="Flagged but undisclosed"
            value={compact(exposure.length, 1)}
            hint="Brandwatch says paid, the caption does not"
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Off-topic means <span className="text-ink-2">about &lt; 0.5</span>: Jev does not think the post is substantively about the brand's
          hair-removal product. {uncertain.length.toLocaleString('en-GB')} posts ({share(uncertain.length, posts.length)}) sit in the uncertain
          band, 0.35 ≤ about ≤ 0.65 — they are counted wherever the threshold puts them and shown here so you know how wide the grey area is.
        </p>
      </Card>

      <ByBrand posts={posts} mode={mode} setMode={setMode} />
      <ByMonth posts={posts} mode={mode} />
      <ByFormat posts={posts} />
      <OffTopicTable posts={offTopic} />
      <Disclosure posts={posts} />
      <Languages posts={posts} />
      <Method data={data} uncertain={uncertain.length} />
    </div>
  )
}

/* -------------------------------------------- 2. reported vs real by brand */

function ByBrand({ posts, mode, setMode }: { posts: ScoredPost[]; mode: Mode; setMode: (m: Mode) => void }) {
  const rows = useMemo(
    () =>
      BRAND_ORDER.map((id) => {
        const rs = posts.filter((p) => p.brandId === id)
        const rep = sum(rs, (p) => p.emv)
        const real = sum(rs, (p) => realEmv(p, mode))
        return { id, name: brandName(id), reported: rep, real, retained: rep ? real / rep : 0 }
      }),
    [posts, mode],
  )

  const byReported = [...rows].sort((a, b) => b.reported - a.reported)
  const byReal = [...rows].sort((a, b) => b.real - a.real)
  // Every brand that climbed, and the brand whose place it took.
  const overtakes = byReal
    .map((r, i) => ({ name: r.name, climbed: byReported.findIndex((x) => x.id === r.id) - i, passed: byReported[i].name }))
    .filter((m) => m.climbed > 0)
    .map((m) => `${m.name} overtakes ${m.passed}`)
  const rankingNote = overtakes.length
    ? `On real EMV, ${overtakes.join('; ')}.`
    : 'The ranking does not change: the brands sit in the same order on real EMV as on reported EMV.'

  return (
    <Card>
      <SectionTitle
        title="Reported vs real, by brand"
        sub={MODE_COPY[mode].definition}
        right={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
            {(['strict', 'weighted'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={segButton(mode === m)}>
                {MODE_COPY[m].label}
              </button>
            ))}
          </div>
        }
      />
      <div className="h-80">
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }} barSize={12} barGap={3}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tickFormatter={(v) => money(v)} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => money(v)} />} />
            <Bar dataKey="reported" name="Reported EMV" fill="var(--neutral-fill)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            <Bar dataKey="real" name={`Real EMV (${mode})`} radius={[0, 3, 3, 0]} minPointSize={2} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.id} fill={brandSlot(r.id)} />
              ))}
              <LabelList
                dataKey="retained"
                position="right"
                formatter={(v: unknown) => `${Math.round(Number(v) * 100)}% kept`}
                style={{ fill: 'var(--ink-2)', fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Legend items={[{ label: 'Reported EMV', color: 'var(--neutral-fill)' }, { label: `Real EMV (${mode})`, color: 'var(--accent)' }]} />
        <p className="text-xs text-ink-2">{rankingNote}</p>
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------- 3. by month */

function ByMonth({ posts, mode }: { posts: ScoredPost[]; mode: Mode }) {
  const [sameScale, setSameScale] = useState(false)
  const series = useMemo(
    () =>
      BRAND_ORDER.map((id) => {
        const rs = posts.filter((p) => p.brandId === id)
        const data = MONTHS.map((m) => {
          const inMonth = rs.filter((p) => p.date.slice(0, 7) === m)
          return { label: monthLabel(m), reported: sum(inMonth, (p) => p.emv), real: sum(inMonth, (p) => realEmv(p, mode)) }
        })
        return { id, name: brandName(id), data, peak: Math.max(0, ...data.map((d) => d.reported)) }
      }),
    [posts, mode],
  )
  const globalMax = Math.max(1, ...series.map((s) => s.peak))

  return (
    <Card>
      <SectionTitle
        title="By month"
        sub="Reported against real EMV per month, Oct 2025 → Jul 2026. August 2026 holds three posts and is dropped."
        right={
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={sameScale} onChange={(e) => setSameScale(e.target.checked)} className="accent-[var(--accent)]" />
            same scale
          </label>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-ink">
                <Swatch id={s.id} />
                {s.name}
              </span>
              <span className="text-xs text-muted">peak {money(s.peak)}</span>
            </div>
            <div className="h-28">
              <ResponsiveContainer>
                <LineChart data={s.data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <YAxis domain={[0, sameScale ? globalMax : 'auto']} hide />
                  <XAxis dataKey="label" hide />
                  <Tooltip content={<ChartTooltip format={(v) => money(v)} />} />
                  <Line type="monotone" dataKey="reported" name="Reported" stroke="var(--neutral-fill)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line
                    type="monotone"
                    dataKey="real"
                    name={`Real (${mode})`}
                    stroke={brandSlot(s.id)}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>{monthLabel(MONTHS[0])}</span>
              <span>{monthLabel(MONTHS[MONTHS.length - 1])}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Legend items={[{ label: 'Reported EMV', color: 'var(--neutral-fill)' }, { label: `Real EMV (${mode})`, color: 'var(--accent)' }]} />
      </div>
    </Card>
  )
}

/* ------------------------------------------------- 4. EMV by post format */

function ByFormat({ posts }: { posts: ScoredPost[] }) {
  const rows = useMemo(
    () =>
      BRAND_ORDER.map((id) => {
        const rs = posts.filter((p) => p.brandId === id)
        const row: Record<string, number | string> = { name: brandName(id), total: sum(rs, (p) => p.emv) }
        for (const f of FORMATS) row[f] = sum(rs.filter((p) => p.format === f), (p) => p.emv)
        return row
      }),
    [posts],
  )

  return (
    <Card>
      <SectionTitle
        title="Where the money actually went"
        sub="Reported EMV split by what kind of post Jev says it is. The muted block on the right of each bar is EMV earned by posts that are not about the product at all."
      />
      <div className="h-72">
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }} barSize={18}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tickFormatter={(v) => money(v)} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => money(v)} />} />
            {FORMATS.map((f, i) => (
              <Bar
                key={f}
                dataKey={f}
                name={FORMAT_LABEL[f]}
                stackId="f"
                fill={FORMAT_FILL[f]}
                stroke="var(--surface)"
                strokeWidth={1}
                isAnimationActive={false}
                radius={i === FORMATS.length - 1 ? [0, 4, 4, 0] : undefined}
              >
                {i === FORMATS.length - 1 && (
                  <LabelList dataKey="total" position="right" formatter={(v: unknown) => money(Number(v))} style={{ fill: 'var(--ink-2)', fontSize: 11 }} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={FORMATS.map((f) => ({ label: FORMAT_LABEL[f], color: FORMAT_FILL[f] }))} />
    </Card>
  )
}

/* ------------------------------------------------ 5. biggest off-topic posts */

function OffTopicTable({ posts }: { posts: ScoredPost[] }) {
  const [brand, setBrand] = useState<number | 'all'>('all')
  const rows = useMemo(
    () =>
      posts
        .filter((p) => brand === 'all' || p.brandId === brand)
        .sort((a, b) => b.emv - a.emv)
        .slice(0, 25),
    [posts, brand],
  )
  const shown = sum(rows, (p) => p.emv)

  return (
    <Card>
      <SectionTitle
        title="The biggest off-topic posts"
        sub={`Top 25 by EMV among posts Jev scores below 0.5 on "is this substantively about the product". Together they carry ${money(shown)}.`}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setBrand('all')} className={chipButton(brand === 'all')}>
          All
        </button>
        {category.brands.map((b) => (
          <BrandChip key={b.id} id={b.id} name={b.name} active={brand === b.id} onClick={() => setBrand(b.id)} />
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-normal">Brand</th>
              <th className="py-2 pr-3 font-normal">Creator</th>
              <th className="py-2 pr-3 font-normal">Platform</th>
              <th className="py-2 pr-3 font-normal">Date</th>
              <th className="py-2 pr-3 text-right font-normal">EMV</th>
              <th className="py-2 pr-3 text-right font-normal">About</th>
              <th className="py-2 pr-3 text-right font-normal">Prominence</th>
              <th className="py-2 font-normal">Caption</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.brandId}-${p.id}`} className="border-b border-border align-top last:border-0">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                    <Swatch id={p.brandId} />
                    {brandName(p.brandId)}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
                    {p.username || '—'}
                  </a>
                </td>
                <td className="py-2 pr-3 text-ink-2">{p.platform}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular text-ink-2">{p.date}</td>
                <td className="py-2 pr-3 text-right tabular text-ink">
                  <Num n={p.emv} />
                </td>
                <td className="py-2 pr-3 text-right tabular text-ink-2">{probPct(p.about)}</td>
                <td className="py-2 pr-3 text-right tabular text-ink-2">{p.prom.toFixed(2)} / 3</td>
                <td className="max-w-md py-2 text-xs leading-relaxed text-muted">{p.snippet || <em>no caption</em>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-sm text-muted">
                  No off-topic posts for this brand.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        EMV is heavy-tailed, so a handful of rows like these move a brand's total on their own. Read them: the aggregate is only as good as the
        individual calls.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------ 6. disclosure audit */

type DiscView = 'exposure' | 'unflagged' | 'both'
const DISC_LABEL: Record<DiscView, string> = {
  exposure: 'Flagged but undisclosed',
  unflagged: 'Disclosed but unflagged',
  both: 'Disclosed and flagged',
}
const discMatch = (p: ScoredPost, v: DiscView) =>
  v === 'exposure' ? p.paidFlag && p.disclosed < DISCLOSED : v === 'unflagged' ? !p.paidFlag && p.disclosed >= DISCLOSED : p.paidFlag && p.disclosed >= DISCLOSED

function Disclosure({ posts }: { posts: ScoredPost[] }) {
  const [view, setView] = useState<DiscView>('exposure')
  const [country, setCountry] = useState<string>('all')

  const cells = (rs: ScoredPost[]) => ({
    both: rs.filter((p) => p.paidFlag && p.disclosed >= DISCLOSED).length,
    discOnly: rs.filter((p) => !p.paidFlag && p.disclosed >= DISCLOSED).length,
    flagOnly: rs.filter((p) => p.paidFlag && p.disclosed < DISCLOSED).length,
    neither: rs.filter((p) => !p.paidFlag && p.disclosed < DISCLOSED).length,
  })
  const overall = useMemo(() => cells(posts), [posts])

  const matching = useMemo(() => posts.filter((p) => discMatch(p, view)), [posts, view])
  const countries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of matching) counts.set(p.country || 'Unknown', (counts.get(p.country || 'Unknown') ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [matching])
  const rows = useMemo(
    () =>
      matching
        .filter((p) => country === 'all' || (p.country || 'Unknown') === country)
        .sort((a, b) => b.emv - a.emv)
        .slice(0, 30),
    [matching, country],
  )

  return (
    <Card>
      <SectionTitle
        title="Disclosure audit"
        sub="Jev's read of the caption against Brandwatch's is_paid flag. Disclosed means the caption says so in any language: #ad, AD |, Werbung, Anzeige, annons, reklam, gifted, a discount code."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Disclosed and flagged" value={overall.both.toLocaleString('en-GB')} hint="both agree it is paid" />
        <StatTile label="Disclosed but unflagged" value={overall.discOnly.toLocaleString('en-GB')} hint="the export missed the disclosure" />
        <StatTile label="Flagged but undisclosed" value={overall.flagOnly.toLocaleString('en-GB')} hint="the exposure" />
        <StatTile label="Neither" value={overall.neither.toLocaleString('en-GB')} hint="organic as far as both can tell" />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-normal">Brand</th>
              <th className="py-2 pr-3 text-right font-normal">Disclosed &amp; flagged</th>
              <th className="py-2 pr-3 text-right font-normal">Disclosed, unflagged</th>
              <th className="py-2 pr-3 text-right font-normal">Flagged, undisclosed</th>
              <th className="py-2 text-right font-normal">Neither</th>
            </tr>
          </thead>
          <tbody>
            {BRAND_ORDER.map((id) => {
              const c = cells(posts.filter((p) => p.brandId === id))
              return (
                <tr key={id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                      <Swatch id={id} />
                      {brandName(id)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-ink-2">{c.both}</td>
                  <td className="py-2 pr-3 text-right tabular text-ink-2">{c.discOnly}</td>
                  <td className="py-2 pr-3 text-right tabular font-medium text-ink">{c.flagOnly}</td>
                  <td className="py-2 text-right tabular text-muted">{c.neither}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-0.5 sm:w-fit">
        {(['exposure', 'unflagged', 'both'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v)
              setCountry('all')
            }}
            aria-pressed={view === v}
            className={segButton(view === v)}
          >
            {DISC_LABEL[v]}
          </button>
        ))}
      </div>
      {countries.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setCountry('all')} className={chipButton(country === 'all')}>
            All countries
          </button>
          {countries.map(([c, n]) => (
            <button key={c} type="button" onClick={() => setCountry(c)} className={chipButton(country === c)}>
              {c} <span className="text-xs opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-normal">Creator</th>
              <th className="py-2 pr-3 font-normal">Brand</th>
              <th className="py-2 pr-3 font-normal">Country</th>
              <th className="py-2 pr-3 font-normal">Date</th>
              <th className="py-2 pr-3 text-right font-normal">EMV</th>
              <th className="py-2 pr-3 text-right font-normal">Disclosed</th>
              <th className="py-2 font-normal">Brandwatch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.brandId}-${p.id}`} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
                    {p.username || '—'}
                  </a>
                </td>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                    <Swatch id={p.brandId} />
                    {brandName(p.brandId)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-ink-2">{p.country || 'Unknown'}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular text-ink-2">{p.date}</td>
                <td className="py-2 pr-3 text-right tabular text-ink">
                  <Num n={p.emv} />
                </td>
                <td className="py-2 pr-3 text-right tabular text-ink-2">{probPct(p.disclosed)}</td>
                <td className="py-2">
                  <Pill tone={p.paidFlag ? 'warn' : 'neutral'}>{p.paidFlag ? 'flagged paid' : 'not flagged'}</Pill>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-sm text-muted">
                  Nothing in this cell.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Disclosure obligations sit with the brand as well as the creator, so a post the export calls paid with a caption that says nothing is the
        brand's problem too. This list is a starting point for a human check, not a verdict: Jev reads the caption only, and a disclosure can live
        in the video, in a platform label, or in a contract.
      </p>
    </Card>
  )
}

/* --------------------------------------------------------- 7. languages */

function Languages({ posts }: { posts: ScoredPost[] }) {
  const bwKey = (p: ScoredPost) => (p.bwLanguage === 'unknown' ? 'unknown' : LANG_ORDER.includes(p.bwLanguage) ? p.bwLanguage : 'other')
  const counts = useMemo(() => {
    const bw: Record<string, number> = {}
    const jev: Record<string, number> = {}
    for (const k of LANG_ORDER) {
      bw[k] = 0
      jev[k] = 0
    }
    for (const p of posts) {
      bw[bwKey(p)]++
      jev[LANG_ORDER.includes(p.lang) ? p.lang : 'other']++
    }
    return [
      { name: 'Brandwatch export', ...bw },
      { name: 'Jev', ...jev },
    ]
  }, [posts])

  const unknown = posts.filter((p) => p.bwLanguage === 'unknown')
  const resolved = unknown.filter((p) => p.lang && p.lang !== 'other')

  const emvByLang = useMemo(() => {
    const keys = LANG_ORDER.filter((k) => k !== 'unknown')
    return keys
      .map((k) => ({
        key: k,
        total: sum(posts.filter((p) => p.lang === k), (p) => p.emv),
        byBrand: Object.fromEntries(BRAND_ORDER.map((id) => [id, sum(posts.filter((p) => p.lang === k && p.brandId === id), (p) => p.emv)])) as Record<
          number,
          number
        >,
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [posts])

  return (
    <Card>
      <SectionTitle
        title="Markets Brandwatch couldn't see"
        sub={`${share(unknown.length, posts.length)} of posts had no language in the export. Jev names one for ${share(resolved.length, unknown.length)} of those.`}
      />
      <div className="h-40">
        <ResponsiveContainer>
          <BarChart data={counts} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }} barSize={30}>
            <XAxis type="number" axisLine={{ stroke: 'var(--axis)' }} tickLine={false} tickFormatter={(v) => compact(v, 0)} />
            <YAxis type="category" dataKey="name" width={130} axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => `${v} posts`} />} />
            {LANG_ORDER.map((k, i) => (
              <Bar key={k} dataKey={k} name={LANG_LABEL[k] ?? k} stackId="l" fill={langFill(k, i)} stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={LANG_ORDER.map((k, i) => ({ label: LANG_LABEL[k] ?? k, color: langFill(k, i) }))} />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-normal">Language (Jev)</th>
              {BRAND_ORDER.map((id) => (
                <th key={id} className="py-2 pr-3 text-right font-normal">
                  {brandName(id)}
                </th>
              ))}
              <th className="py-2 text-right font-normal">Total EMV</th>
            </tr>
          </thead>
          <tbody>
            {emvByLang.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="py-2 pr-3 text-ink">{LANG_LABEL[r.key] ?? r.key}</td>
                {BRAND_ORDER.map((id) => (
                  <td key={id} className="py-2 pr-3 text-right tabular text-ink-2">
                    {r.byBrand[id] ? money(r.byBrand[id]) : '–'}
                  </td>
                ))}
                <td className="py-2 text-right tabular font-medium text-ink">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Per-market reporting was impossible on the export as delivered: the language column is empty on most rows. It is a free side-effect of the
        same request that answered the other five questions.
      </p>
    </Card>
  )
}

/* -------------------------------------------------- 8. method and caveats */

function Method({ data, uncertain }: { data: ScoredPostsFile; uncertain: number }) {
  const q = data.questions
  return (
    <Card>
      <SectionTitle title="Method and caveats" sub="What was asked, of what, at what cost — and what this page cannot tell you." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">The six questions, verbatim</h3>
          <dl className="grid gap-3">
            {Object.entries(q).map(([key, spec]) => (
              <div key={key} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                <dt className="flex items-center gap-2 text-sm font-medium text-ink">
                  {key}
                  <Pill>{spec.type}</Pill>
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-ink-2">{spec.instructions}</dd>
                {spec.type === 'choice' && (
                  <dd className="mt-1 text-xs text-muted">
                    {Object.entries(spec.criteria)
                      .map(([k, v]) => `${k} — ${v}`)
                      .join(' · ')}
                  </dd>
                )}
                {spec.type === 'score' && <dd className="mt-1 text-xs text-muted">{spec.criteria.map((c, i) => `${i} ${c}`).join(' · ')}</dd>}
              </div>
            ))}
          </dl>
        </div>

        <div className="grid gap-4 content-start">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Thresholds</h3>
            <ul className="grid gap-1 text-sm leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">Reported EMV</strong> — the export's <code>emv</code>, summed. What the Category page shows today.
              </li>
              <li>
                <strong className="text-ink">Real EMV (strict)</strong> — EMV of posts where <code>about ≥ 0.5</code>. Earned by posts that are
                actually about the product.
              </li>
              <li>
                <strong className="text-ink">Real EMV (weighted)</strong> — <code>Σ emv × prom / 3</code>. Each post counts in proportion to how
                central the product is.
              </li>
              <li>
                <strong className="text-ink">Off-topic</strong> — <code>about &lt; 0.5</code>. <strong className="text-ink">Passing mention</strong>{' '}
                — <code>prom &lt; 1.5</code>.
              </li>
              <li>
                <strong className="text-ink">Disclosed</strong> — <code>disclosed ≥ 0.5</code>. <strong className="text-ink">Flagged</strong> —
                Brandwatch <code>is_paid</code>.
              </li>
              <li>
                <strong className="text-ink">Uncertain</strong> — <code>0.35 ≤ about ≤ 0.65</code>: {uncertain.toLocaleString('en-GB')} posts.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">The run</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Coverage"
                value={`${data.coverage.scored.toLocaleString('en-GB')} / ${data.coverage.posts.toLocaleString('en-GB')}`}
                hint={`${data.coverage.failed} gave up after 12 attempts`}
              />
              <StatTile label="Spend" value={`$${data.spend.costUsd.toFixed(2)}`} hint={`$${(data.spend.costUsd / Math.max(1, data.coverage.scored)).toFixed(6)} per post`} />
              <StatTile label="Model time" value={`${Math.round(data.spend.modelMs / 1000).toLocaleString('en-GB')} s`} hint={`${Math.round(data.spend.modelMs / Math.max(1, data.coverage.scored))} ms per post`} />
              <StatTile label="Wall time" value={`${(data.spend.wallSeconds / 3600).toFixed(1)} h`} hint="the provider's queue, not the model" />
            </div>
            <p className="mt-2 text-xs text-muted">
              Model <code>{data.model}</code>, six questions in one round trip per post, run by{' '}
              <code className="text-ink-2">scripts/score_posts.py</code> against the deployed <code>/api/evaluate</code>. Generated{' '}
              {data.generatedAt.slice(0, 10)}.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Three honest caveats</h3>
            <ul className="grid gap-2 text-sm leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">Captions only.</strong> Jev never sees the video. A product held up on screen for twenty seconds and
                never mentioned in the caption scores low here, and that is a real limitation, not a rounding error.
              </li>
              <li>
                <strong className="text-ink">These are judgements, not ground truth.</strong> <code>about</code> and <code>prom</code> are a model's
                read with the probability it assigned shown next to them. The uncertain band exists because some posts genuinely are.
              </li>
              <li>
                <strong className="text-ink">EMV is heavy-tailed.</strong> A handful of posts move the totals, which is exactly why the table above
                lists the biggest off-topic posts one by one instead of asking you to trust the sum.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  )
}
