import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { category, brandSlot, shortName } from '../lib/data'
import { compact, money, pct } from '../lib/format'
import { Card, ChartTooltip, Legend, Pill, SectionTitle, StatTile, Swatch, Translated } from './ui'

const brands = category.brands

export default function Overview({ onOpen }: { onOpen: (id: number) => void }) {
  const totals = brands.reduce(
    (a, b) => ({ posts: a.posts + b.metrics.posts, inf: a.inf + b.metrics.influencers, emv: a.emv + b.metrics.emv, impr: a.impr + b.metrics.impressions }),
    { posts: 0, inf: 0, emv: 0, impr: 0 },
  )
  const rank = brands.map((b) => ({ id: b.id, name: shortName(b.name), emv: b.metrics.emv, posts: b.metrics.posts }))
  const sentiment = brands.map((b) => ({
    id: b.id,
    name: shortName(b.name),
    positive: b.metrics.sentiment.positive.pct,
    neutral: b.metrics.sentiment.neutral.pct,
    negative: b.metrics.sentiment.negative.pct,
  }))
  const weeklyMax = Math.max(...brands.flatMap((b) => b.weekly.map((w) => w.influencers)))
  const first = brands.map((b) => b.metrics.firstPost).sort()[0]
  const last = brands.map((b) => b.metrics.lastPost).sort().at(-1)

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Creator posts tracked" value={compact(totals.posts, 1)} hint={`${first} → ${last}`} />
        <StatTile label="Unique creators" value={compact(totals.inf, 1)} hint="across TikTok, Instagram, YouTube" />
        <StatTile label="Earned media value" value={money(totals.emv)} hint="sum of six brand segments" />
        <StatTile label="Estimated impressions" value={compact(totals.impr, 0)} hint="follower-weighted reach" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <SectionTitle title="Who is buying the conversation" sub="Earned media value of creator posts mentioning each brand, Oct 2025 → Aug 2026" />
          <p className="-mt-2 mb-2 text-sm text-ink-2">
            Counts every matched post. See{' '}
            <button type="button" onClick={() => { window.location.hash = '#/real-emv' }} className="text-ink underline underline-offset-2 hover:text-accent">
              Real EMV
            </button>{' '}
            for the share that is actually about the product.
          </p>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={rank} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }} barSize={18}>
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" tickFormatter={(v) => money(v)} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => money(v)} />} />
                <Bar dataKey="emv" name="EMV" fill="var(--s1)" radius={[0, 4, 4, 0]} onClick={(d) => onOpen((d as unknown as { id: number }).id)} className="cursor-pointer">
                  {rank.map((r) => (
                    <Cell key={r.id} fill={brandSlot(r.id)} />
                  ))}
                  <LabelList dataKey="emv" position="right" formatter={(v: unknown) => money(Number(v))} style={{ fill: 'var(--ink-2)', fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted">Click a bar to open the brand. Colors follow the brand across every view.</p>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle title="How the audience reacts" sub="Post-level sentiment, share of posts" />
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={sentiment} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }} barSize={16}>
                <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow tickFormatter={(v) => v + '%'} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => pct(v)} />} />
                <Bar dataKey="positive" name="Positive" stackId="s" fill="var(--good)" stroke="var(--surface)" strokeWidth={2} />
                <Bar dataKey="neutral" name="Neutral" stackId="s" fill="var(--neutral-fill)" stroke="var(--surface)" strokeWidth={2} />
                <Bar dataKey="negative" name="Negative" stackId="s" fill="var(--critical)" stroke="var(--surface)" strokeWidth={2} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Positive', color: 'var(--good)' }, { label: 'Neutral', color: 'var(--neutral-fill)' }, { label: 'Negative', color: 'var(--critical)' }]} />
        </Card>
      </div>

      <Card>
        <SectionTitle title="Creator activity by week" sub="Unique creators posting about each brand per week, shared scale" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => {
            const peak = b.weekly.reduce((m, w) => (w.influencers > m.influencers ? w : m), b.weekly[0] ?? { label: '', influencers: 0 })
            return (
              <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="rounded-lg border border-border p-3 text-left hover:bg-surface-2">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium text-ink"><Swatch id={b.id} />{shortName(b.name)}</span>
                  <span className="text-xs text-muted">peak {peak.influencers} · {peak.label}</span>
                </div>
                <div className="h-24">
                  <ResponsiveContainer>
                    <LineChart data={b.weekly} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                      <YAxis domain={[0, weeklyMax]} hide />
                      <XAxis dataKey="label" hide />
                      <Tooltip content={<ChartTooltip format={(v) => `${v} creators`} />} />
                      <Line type="monotone" dataKey="influencers" name="Creators" stroke={brandSlot(b.id)} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle title="The read on each brand" sub="One-line diagnosis generated from the full post set, per brand" />
        <div className="grid gap-3 md:grid-cols-2">
          {brands.map((b) => (
            <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="rounded-lg border border-border p-4 text-left hover:bg-surface-2">
              <div className="mb-2 flex items-center gap-2">
                <Swatch id={b.id} />
                <span className="font-medium text-ink">{b.name}</span>
                <Pill tone={b.framing.includes('risk') ? 'bad' : 'accent'}>{b.framing}</Pill>
              </div>
              <p className="text-sm leading-relaxed text-ink-2"><Translated text={b.headline} /></p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>{compact(b.metrics.posts, 1)} posts</span>
                <span>{compact(b.metrics.influencers, 1)} creators</span>
                <span>{money(b.metrics.emv)} EMV</span>
                <span>{pct(b.metrics.sentiment.positive.pct)} positive</span>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
