import { useEffect, useMemo, useState } from 'react'
import { category, loadBrand, shortName } from '../lib/data'
import type { Brand, Platform } from '../lib/types'
import { Card, Pill, Quote, SectionTitle, Swatch } from './ui'

const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube']
const DIMS: { key: string; label: string }[] = [
  { key: 'purchase_intent', label: 'Purchase intent' },
  { key: 'objections', label: 'Objections' },
  { key: 'faq_gaps', label: 'Unanswered questions' },
  { key: 'safety_complaints', label: 'Safety complaints' },
  { key: 'crisis_backlash', label: 'Backlash' },
  { key: 'loyalty_signals', label: 'Loyalty' },
  { key: 'feature_requests', label: 'Feature requests' },
  { key: 'competitor_mentions', label: 'Competitor mentions' },
  { key: 'partnership_perception', label: 'Ad perception' },
]

export function useAllBrands() {
  const [brands, setBrands] = useState<Brand[] | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all(category.brands.map((b) => loadBrand(b.id))).then((bs) => alive && setBrands(bs))
    return () => { alive = false }
  }, [])
  return brands
}

function sumDim(b: Brand, key: string) {
  let n = 0, sample = 0
  for (const p of PLATFORMS) {
    const pc = b.comments[p]
    if (!pc) continue
    n += pc.dimensions[key]?.count ?? 0
    sample += pc.sampleSize ?? 0
  }
  return { n, sample, per100: sample ? (n / sample) * 100 : 0 }
}

type Item = Record<string, unknown> & { platform: Platform }
function items(b: Brand, key: string): Item[] {
  return PLATFORMS.flatMap((p) => (b.comments[p]?.dimensions[key]?.items ?? []).map((it) => ({ ...it, platform: p })))
}
function quotes(b: Brand, key: string) {
  return PLATFORMS.flatMap((p) => (b.comments[p]?.dimensions[key]?.top_quotes ?? []).map((q) => ({ ...q, platform: p })))
}

export default function Compare({ onOpen }: { onOpen: (id: number) => void }) {
  const brands = useAllBrands()
  const [dim, setDim] = useState('objections')

  const matrix = useMemo(() => {
    if (!brands) return null
    return DIMS.map((d) => ({ ...d, cells: brands.map((b) => ({ id: b.id, ...sumDim(b, d.key) })) }))
  }, [brands])
  const maxPer100 = useMemo(() => (matrix ? Math.max(...matrix.flatMap((r) => r.cells.map((c) => c.per100))) : 1), [matrix])

  const competitorGraph = useMemo(() => {
    if (!brands) return []
    const rows: { from: Brand; to: string; n: number; favored: Record<string, number> }[] = []
    for (const b of brands) {
      const byName = new Map<string, { n: number; favored: Record<string, number> }>()
      for (const it of items(b, 'competitor_mentions')) {
        const name = String(it.competitor_name ?? '').trim()
        if (!name) continue
        const e = byName.get(name) ?? { n: 0, favored: {} }
        e.n++
        const f = String(it.favored_side ?? 'unclear')
        e.favored[f] = (e.favored[f] ?? 0) + 1
        byName.set(name, e)
      }
      for (const [to, e] of byName) rows.push({ from: b, to, n: e.n, favored: e.favored })
    }
    return rows.sort((a, c) => c.n - a.n)
  }, [brands])

  const objectionCats = useMemo(() => {
    if (!brands) return []
    const cats = new Map<string, Map<number, number>>()
    for (const b of brands) for (const it of items(b, 'objections')) {
      const c = String(it.category ?? 'other')
      const m = cats.get(c) ?? new Map<number, number>()
      m.set(b.id, (m.get(b.id) ?? 0) + 1)
      cats.set(c, m)
    }
    return [...cats].map(([cat, m]) => ({ cat, total: [...m.values()].reduce((a, v) => a + v, 0), byBrand: m })).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [brands])

  const blockers = useMemo(() => {
    if (!brands) return []
    return brands.map((b) => {
      const its = items(b, 'purchase_intent')
      const withBlock = its.filter((it) => it.blocker)
      const avg = its.length ? its.reduce((a, it) => a + Number(it.score ?? 0), 0) / its.length : 0
      return { b, n: its.length, blocked: withBlock.length, avg, examples: withBlock.slice(0, 3).map((it) => String(it.blocker)) }
    })
  }, [brands])

  if (!brands || !matrix) return <div className="h-64 animate-pulse rounded-xl bg-surface-2" />

  return (
    <div className="grid gap-4">
      <Card>
        <SectionTitle title="Listening signal density" sub="Flagged comments per 100 sampled, across all platforms. Darker = more of that signal. Click a row to see the quotes." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-2 pr-3 text-left font-medium">Signal</th>
                {brands.map((b) => (
                  <th key={b.id} className="px-1 py-2 text-center font-medium">
                    <button type="button" onClick={() => onOpen(b.id)} className="inline-flex items-center gap-1.5 hover:text-ink"><Swatch id={b.id} />{shortName(b.name)}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.key} onClick={() => setDim(r.key)} className={`cursor-pointer border-t border-border ${dim === r.key ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
                  <td className="py-1.5 pr-3 font-medium text-ink">{r.label}</td>
                  {r.cells.map((c) => {
                    const t = maxPer100 ? c.per100 / maxPer100 : 0
                    return (
                      <td key={c.id} className="px-1 py-1.5 text-center">
                        <div className="mx-auto flex h-8 w-16 items-center justify-center rounded-md tabular text-xs" style={{ background: `color-mix(in oklab, var(--accent) ${Math.round(8 + t * 82)}%, var(--surface))`, color: t > 0.55 ? '#fff' : 'var(--ink)' }} title={`${c.n} flagged of ${c.sample} sampled`}>
                          {c.per100.toFixed(1)}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {brands.map((b) => {
            const qs = quotes(b, dim).filter((q) => q.text?.trim()).slice(0, 2)
            return (
              <div key={b.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink"><Swatch id={b.id} />{shortName(b.name)} <span className="text-xs font-normal text-muted">· {DIMS.find((d) => d.key === dim)?.label}</span></div>
                {qs.length ? qs.map((q, i) => <div key={i} className="mb-1.5"><Quote text={q.text} meta={q.platform} /></div>) : <div className="text-xs text-muted">No quotes captured.</div>}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Who gets named in whose comments" sub="Competitor mentions found under each brand's creator posts, with who the commenter favoured" />
          <ul className="grid gap-1.5">
            {competitorGraph.slice(0, 18).map((r, i) => {
              const fav = r.favored['competitor'] ?? 0, focal = r.favored['focal_brand'] ?? 0
              return (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex w-36 shrink-0 items-center gap-1.5 text-ink"><Swatch id={r.from.id} />{shortName(r.from.name)}</span>
                  <span className="text-muted">→</span>
                  <span className="flex-1 font-medium text-ink">{r.to}</span>
                  <span className="tabular text-xs text-muted">{r.n}×</span>
                  {fav > focal ? <Pill tone="bad">rival wins {fav}</Pill> : focal > fav ? <Pill tone="good">brand wins {focal}</Pill> : <Pill>mixed</Pill>}
                </li>
              )
            })}
          </ul>
        </Card>

        <Card>
          <SectionTitle title="What people object to" sub="Objection categories across the six brands, by count of classified comments" />
          <div className="grid gap-2">
            {objectionCats.map((c) => (
              <div key={c.cat}>
                <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-ink">{c.cat.replace(/_/g, ' ')}</span><span className="tabular text-muted">{c.total}</span></div>
                <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-2">
                  {brands.map((b) => {
                    const v = c.byBrand.get(b.id) ?? 0
                    return v ? <div key={b.id} title={`${shortName(b.name)}: ${v}`} style={{ width: `${(v / c.total) * 100}%`, background: `var(--s${category.brands.findIndex((x) => x.id === b.id) + 1})`, boxShadow: '-2px 0 0 var(--surface)' }} /> : null
                  })}
                </div>
              </div>
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            {brands.map((b) => (<li key={b.id} className="flex items-center gap-1.5"><Swatch id={b.id} />{shortName(b.name)}</li>))}
          </ul>
        </Card>
      </div>

      <Card>
        <SectionTitle title="Intent vs. friction" sub="Purchase-intent comments and how many of them named something blocking the purchase" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {blockers.map(({ b, n, blocked, avg, examples }) => (
            <div key={b.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink"><Swatch id={b.id} />{shortName(b.name)}</span>
                <span className="text-xs text-muted">avg intent {avg.toFixed(2)}</span>
              </div>
              <div className="mt-2 text-sm text-ink-2"><span className="tabular font-semibold text-ink">{blocked}</span> of <span className="tabular">{n}</span> high-intent comments hit a blocker</div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-surface-2"><div className="h-full" style={{ width: `${n ? (blocked / n) * 100 : 0}%`, background: 'var(--serious)' }} /></div>
              <ul className="mt-2 grid gap-1 text-xs text-ink-2">
                {examples.map((e, i) => <li key={i}>· {e}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
