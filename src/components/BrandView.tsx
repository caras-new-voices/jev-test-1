import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { brandSlot, category, hasPosts, loadBrand, loadPosts } from '../lib/data'
import { compact, money, pct, titleCase } from '../lib/format'
import type { Brand, Dimension, Platform, Post } from '../lib/types'
import { Card, ChartTooltip, InsightHtml, Pill, Quote, SectionTitle, StatTile, Swatch, Translated } from './ui'

const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube']
const PLATFORM_LABEL: Record<Platform | 'all', string> = { all: 'All platforms', tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' }

const DIMENSION_META: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'accent'; blurb: string }> = {
  purchase_intent: { label: 'Purchase intent', tone: 'good', blurb: 'Comments that say “I’m buying” and what blocks them' },
  objections: { label: 'Objections', tone: 'bad', blurb: 'Reasons people push back' },
  faq_gaps: { label: 'Unanswered questions', tone: 'accent', blurb: 'What the audience keeps asking' },
  safety_complaints: { label: 'Safety complaints', tone: 'bad', blurb: 'Irritation, cuts, reactions' },
  crisis_backlash: { label: 'Backlash signals', tone: 'bad', blurb: 'Escalation and trust risks' },
  loyalty_signals: { label: 'Loyalty signals', tone: 'good', blurb: 'Repeat buyers and long-term users' },
  feature_requests: { label: 'Feature requests', tone: 'accent', blurb: 'What they wish existed' },
  competitor_mentions: { label: 'Competitor mentions', tone: 'warn', blurb: 'Who gets named in the comments' },
  cross_brand_affinity: { label: 'Brand affinity', tone: 'neutral', blurb: 'Retailers and adjacent brands' },
  use_case_discovery: { label: 'New use cases', tone: 'accent', blurb: 'Unexpected ways it gets used' },
  partnership_perception: { label: 'Ad perception', tone: 'warn', blurb: 'How sponsored content lands' },
  engagement_quality: { label: 'Engagement quality', tone: 'neutral', blurb: 'Bots, boilerplate, emoji-only' },
}
const DIMENSION_ORDER = Object.keys(DIMENSION_META)

export default function BrandView({ id }: { id: number }) {
  const [brand, setBrand] = useState<Brand | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [aiTab, setAiTab] = useState<'all' | Platform>('all')
  const [ciTab, setCiTab] = useState<Platform>('tiktok')

  useEffect(() => {
    let alive = true
    setBrand(null); setPosts(null); setAiTab('all'); setCiTab('tiktok')
    loadBrand(id).then((b) => alive && setBrand(b))
    if (hasPosts(id)) loadPosts(id).then((p) => alive && setPosts(p?.posts ?? null))
    return () => { alive = false }
  }, [id])

  const index = category.brands.find((b) => b.id === id)!
  const m = index.metrics
  const platformMix = PLATFORMS.map((p) => ({ name: PLATFORM_LABEL[p], value: m.byPlatform[p] }))
  const tiers = [
    { name: 'Nano', value: m.tiers.nano },
    { name: 'Micro', value: m.tiers.micro },
    { name: 'Mid', value: m.tiers.midTier },
    { name: 'Macro', value: m.tiers.macro },
    { name: 'Mega', value: m.tiers.mega },
  ]

  const ci = brand?.comments[ciTab]
  const dims = useMemo(() => {
    if (!ci) return []
    return DIMENSION_ORDER.map((k) => [k, ci.dimensions[k]] as const).filter((x): x is readonly [string, Dimension] => Boolean(x[1]))
  }, [ci])

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sm text-ink-2"><Swatch id={id} size={12} /> Brand segment · scanned from {index.scanStart} · analysed {index.analyzedAt}</div>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{index.name}</h1>
            <p className="mt-2 text-base leading-relaxed text-ink-2"><Translated text={index.headline} /></p>
          </div>
          <Pill tone={index.framing.includes('risk') ? 'bad' : 'accent'}>{index.framing}</Pill>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Posts" value={compact(m.posts, 1)} hint={`${m.firstPost} → ${m.lastPost}`} />
        <StatTile label="Creators" value={compact(m.influencers, 1)} hint={`${m.paidInfluencers} flagged paid`} />
        <StatTile label="EMV" value={money(m.emv)} hint={`est. spend ${money(m.budgetMin)}–${money(m.budgetMax)}`} />
        <StatTile label="Engagement" value={compact(m.engagement, 1)} hint="likes + comments + shares" />
        <StatTile label="Impressions" value={compact(m.impressions, 0)} hint="follower-weighted" />
        <StatTile label="Positive" value={pct(m.sentiment.positive.pct)} hint={`${pct(m.sentiment.negative.pct)} negative`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle title="Where the posts are" sub="Posts by platform" />
          <MiniBars data={platformMix} color={brandSlot(id)} />
        </Card>
        <Card>
          <SectionTitle title="Who is posting" sub="Creators by follower tier" />
          <MiniBars data={tiers} color={brandSlot(id)} />
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Assess · Anticipate · Act"
          sub={brand ? `Strategic read generated from ${brand.aiMeta.itemsAnalyzed ?? m.posts} posts` : 'Loading…'}
          right={<Tabs value={aiTab} onChange={setAiTab} options={(['all', ...PLATFORMS] as const).map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))} />}
        />
        {brand?.ai[aiTab] ? (
          <div>
            <p className="mb-4 rounded-lg bg-surface-2 px-4 py-3 text-sm font-medium leading-relaxed text-ink"><Translated text={brand.ai[aiTab].headline} /></p>
            <div className="grid gap-5 lg:grid-cols-3">
              <InsightHtml html={brand.ai[aiTab].assess} />
              <InsightHtml html={brand.ai[aiTab].anticipate} />
              <InsightHtml html={brand.ai[aiTab].act} />
            </div>
          </div>
        ) : (
          <Skeleton />
        )}
      </Card>

      <Card>
        <SectionTitle
          title="What the comments say"
          sub={ci ? `${ci.sampleSize ?? '–'} comments sampled on ${PLATFORM_LABEL[ciTab]} · classified into twelve listening dimensions` : 'Loading…'}
          right={<Tabs value={ciTab} onChange={setCiTab} options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))} />}
        />
        {ci?.synthesis && (
          <div className="mb-4 grid gap-3">
            <p className="text-sm leading-relaxed text-ink-2">{ci.synthesis.summary}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {ci.synthesis.findings.slice(0, 3).map((f, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="text-sm font-medium text-ink">{f.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">{f.business_implication}</p>
                  <p className="mt-2 text-xs leading-relaxed text-ink"><span className="text-muted">Do: </span>{f.recommended_action_area}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dims.map(([k, d]) => (
            <DimensionCard key={k} k={k} d={d} />
          ))}
        </div>
      </Card>

      {hasPosts(id) && (
        <Card>
          <SectionTitle title="Top creator posts" sub={posts ? `Sample of ${posts.length} posts ranked by engagement` : 'Loading…'} />
          {posts && <PostsTable posts={posts.slice(0, 40)} />}
        </Card>
      )}
    </div>
  )
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} type="button" onClick={() => onChange(o.value)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function MiniBars({ data, color }: { data: { name: string; value: number }[]; color: string }) {
  return (
    <div className="h-40">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -18 }} barSize={22}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="name" axisLine={{ stroke: 'var(--axis)' }} tickLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 11 }} />
          <YAxis tickFormatter={(v) => compact(v, 0)} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
          <Bar dataKey="value" name="Count" fill={color} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="value" position="top" formatter={(v: unknown) => compact(Number(v), 0)} style={{ fill: 'var(--ink-2)', fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function DimensionCard({ k, d }: { k: string; d: Dimension }) {
  const [open, setOpen] = useState(false)
  const meta = DIMENSION_META[k] ?? { label: titleCase(k), tone: 'neutral' as const, blurb: '' }
  const quotes = d.top_quotes.filter((q) => q.text?.trim())
  return (
    <div className="flex flex-col rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">{meta.label}</div>
        <Pill tone={d.count === 0 ? 'neutral' : meta.tone}>{d.count}</Pill>
      </div>
      <div className="text-xs text-muted">{meta.blurb}</div>
      <p className={`mt-2 text-xs leading-relaxed text-ink-2 ${open ? '' : 'line-clamp-3'}`}>{d.summary}</p>
      {quotes.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {quotes.slice(0, open ? quotes.length : 1).map((q, i) => (
            <Quote key={i} text={q.text} />
          ))}
        </div>
      )}
      {(quotes.length > 1 || d.summary.length > 180) && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-2 self-start text-xs font-medium text-accent hover:underline">
          {open ? 'Show less' : `Show ${quotes.length > 1 ? `${quotes.length} quotes` : 'more'}`}
        </button>
      )}
    </div>
  )
}

function PostsTable({ posts }: { posts: Post[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Creator</th>
            <th className="py-2 pr-3 font-medium">Post</th>
            <th className="py-2 pr-3 text-right font-medium">Likes</th>
            <th className="py-2 pr-3 text-right font-medium">Comments</th>
            <th className="py-2 pr-3 text-right font-medium">Views</th>
            <th className="py-2 pr-3 text-right font-medium">EMV</th>
            <th className="py-2 font-medium">Tone</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} className="border-b border-border align-top last:border-0">
              <td className="py-2 pr-3 whitespace-nowrap">
                <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">@{p.username}</a>
                <div className="text-xs text-muted">{p.platform} · {p.tier ?? '–'} · {compact(p.followers, 1)} followers</div>
              </td>
              <td className="py-2 pr-3 max-w-md text-ink-2"><span className="line-clamp-2">{p.text || '(no caption)'}</span><div className="text-xs text-muted">{p.publishedAt}{p.country ? ` · ${p.country}` : ''}</div></td>
              <td className="py-2 pr-3 text-right tabular">{compact(p.likes)}</td>
              <td className="py-2 pr-3 text-right tabular">{compact(p.comments)}</td>
              <td className="py-2 pr-3 text-right tabular">{compact(p.views)}</td>
              <td className="py-2 pr-3 text-right tabular">{money(p.emv)}</td>
              <td className="py-2"><Pill tone={p.sentiment === 'positive' ? 'good' : p.sentiment === 'negative' ? 'bad' : 'neutral'}>{p.sentiment}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Skeleton() {
  return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
}
