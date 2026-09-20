import { useMemo, useRef, useState } from 'react'
import { category, shortName } from '../lib/data'
import type { Brand, Platform } from '../lib/types'
import { DIMENSION_KEYS, DIMENSION_LABELS, evaluate, pct, pooled, topTwo } from '../lib/jev'
import type { BooleanAnswer, ChoiceAnswer, EvalResult, ScoreAnswer } from '../lib/jev'
import { useAllBrands } from './Compare'
import { BrandChip, Card, Pill, Quote, SectionTitle, StatTile } from './ui'

/**
 * Re-classify every verbatim quote in the report, live, and hold the result up
 * against the offline pass that produced the report in the first place.
 *
 * This is the thing that was not practical before: the offline gpt-5.2 job
 * could only afford a sample, and nobody re-runs a batch LLM job in a client
 * meeting to check its work. At Jev's price and latency you can re-do the whole
 * thing in front of them, in well under a minute, for a few cents.
 */

const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube']
const CONCURRENCY = 8

type Item = { brandId: number; brand: string; platform: Platform; offline: string; text: string }
type Row = Item & { result?: EvalResult; error?: string }

function collectQuotes(brands: Brand[], scope: number | 'all'): Item[] {
  const seen = new Set<string>()
  const out: Item[] = []
  for (const b of brands) {
    if (scope !== 'all' && b.id !== scope) continue
    for (const p of PLATFORMS) {
      const dims = b.comments[p]?.dimensions
      if (!dims) continue
      for (const [key, d] of Object.entries(dims)) {
        for (const q of d?.top_quotes ?? []) {
          const t = q.text.trim()
          if (t.length < 3 || seen.has(t)) continue
          seen.add(t)
          out.push({ brandId: b.id, brand: shortName(b.name), platform: p, offline: key, text: t })
        }
      }
    }
  }
  return out
}

const dim = (r: Row) => r.result?.answers.dimension as ChoiceAnswer | undefined
const spam = (r: Row) => (r.result?.answers.spam as BooleanAnswer | undefined)?.probability ?? 0
const call = (r: Row) => (r.result?.answers.worthACall as BooleanAnswer | undefined)?.probability ?? 0
const urg = (r: Row) => (r.result?.answers.urgency as ScoreAnswer | undefined)?.score ?? 0

export default function CorpusSweep() {
  const brands = useAllBrands()
  const [scope, setScope] = useState<number | 'all'>(category.brands[0].id)
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [threshold, setThreshold] = useState(0.8)
  const [view, setView] = useState<'disagree' | 'multi' | 'spam' | 'calls' | 'urgent'>('disagree')
  const abortRef = useRef<AbortController | null>(null)

  const items = useMemo(() => (brands ? collectQuotes(brands, scope) : []), [brands, scope])

  async function run() {
    if (!brands || running) return
    const ctl = new AbortController()
    abortRef.current = ctl
    const start = Date.now()
    setRunning(true)
    setRows(items.map((it) => ({ ...it })))
    const tick = window.setInterval(() => setElapsed(Date.now() - start), 100)
    await pooled(
      items,
      CONCURRENCY,
      (it) => evaluate({ text: it.text, pack: 'triage' }, ctl.signal),
      (i, res) => {
        setRows((prev) => {
          const next = prev.slice()
          next[i] = res instanceof Error ? { ...next[i], error: res.message } : { ...next[i], result: res }
          return next
        })
      },
      ctl.signal,
    )
    window.clearInterval(tick)
    setElapsed(Date.now() - start)
    setRunning(false)
  }

  function stop() {
    abortRef.current?.abort()
  }

  /* ------------------------------------------------------------ analysis */
  const done = rows.filter((r) => r.result)
  const failed = rows.filter((r) => r.error)
  const cost = done.reduce((s, r) => s + Number(r.result?.costUsd ?? 0), 0)
  const tokens = done.reduce((s, r) => s + (r.result?.usage?.inputTokens ?? 0), 0)
  const agree = done.filter((r) => dim(r)?.choice === r.offline)
  const agreeRate = done.length ? agree.length / done.length : 0

  const matrix = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const k of DIMENSION_KEYS) m[k] = Object.fromEntries(DIMENSION_KEYS.map((j) => [j, 0]))
    for (const r of done) {
      const j = dim(r)?.choice
      if (j && m[r.offline] && j in m[r.offline]) m[r.offline][j]++
    }
    return m
  }, [done])
  const matrixMax = Math.max(1, ...Object.values(matrix).flatMap((row) => Object.values(row)))

  const confident = done.filter((r) => (dim(r)?.confidence ?? 0) >= threshold)
  const unsure = done.filter((r) => (dim(r)?.confidence ?? 0) < threshold)
  const agreeConfident = confident.length ? confident.filter((r) => dim(r)?.choice === r.offline).length / confident.length : 0
  const agreeUnsure = unsure.length ? unsure.filter((r) => dim(r)?.choice === r.offline).length / unsure.length : 0

  const disagreements = done.filter((r) => dim(r)?.choice !== r.offline).sort((a, b) => (dim(b)?.confidence ?? 0) - (dim(a)?.confidence ?? 0))
  const multi = done
    .map((r) => ({ r, t2: dim(r) ? topTwo(dim(r)!) : [] }))
    .filter((x) => x.t2.length === 2 && x.t2[1][1] >= 0.25)
    .sort((a, b) => b.t2[1][1] - a.t2[1][1])
  const spamHits = done.filter((r) => spam(r) >= 0.5).sort((a, b) => spam(b) - spam(a))
  const callList = done.filter((r) => spam(r) < 0.5).sort((a, b) => call(b) - call(a)).slice(0, 12)
  const urgentList = done.filter((r) => spam(r) < 0.5).sort((a, b) => urg(b) - urg(a)).slice(0, 12)

  const progress = rows.length ? (done.length + failed.length) / rows.length : 0
  const scopeLabel = scope === 'all' ? 'all six brands' : shortName(category.brands.find((b) => b.id === scope)?.name ?? '')

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Audit the whole report, live"
          sub="Every verbatim quote in this report was filed under one of twelve dimensions by an offline gpt-5.2 batch job. Re-file all of them with Jev, now, and see where the two disagree."
          right={<Pill tone="accent">{items.length} quotes in scope</Pill>}
        />
        <div className="space-y-3 text-sm leading-relaxed text-ink-2">
          <p>
            This is the demonstration that matters most, because it is the one that was not practical before. A batch
            LLM classification is a project: you run it once, on a sample, and you trust it. Nobody re-runs it in a
            meeting to check. Jev makes the same judgement cheap enough and fast enough to{' '}
            <strong className="text-ink">re-do the entire thing in front of the client</strong> — and to ask it
            something the batch job never was: <em>how sure are you?</em>
          </p>
          <p>
            Press run. Each quote goes through the same four-question triage pack, {CONCURRENCY} at a time. When it
            finishes you get a confusion matrix against the offline labels, the quotes that carry two signals at once,
            the spam the offline pass let through, a ranked call list, and — the useful part — a confidence slider that
            shows how much of the corpus could be routed automatically and how much genuinely needs a human.
          </p>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Scope" sub="One brand runs in a few seconds. All six is the full 464 unique quotes." />
        <div className="flex flex-wrap items-center gap-2">
          {category.brands.map((b) => (
            <BrandChip key={b.id} id={b.id} name={b.name} active={scope === b.id} onClick={() => !running && setScope(b.id)} />
          ))}
          <button
            type="button"
            onClick={() => !running && setScope('all')}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${scope === 'all' ? 'border-ink bg-ink text-page' : 'border-border bg-surface text-ink hover:bg-surface-2'}`}
          >
            All six brands
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!running ? (
            <button
              type="button"
              onClick={run}
              disabled={!brands || items.length === 0}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-page transition disabled:opacity-40"
            >
              {rows.length ? `Run again on ${scopeLabel}` : `Run Jev on ${scopeLabel}`}
            </button>
          ) : (
            <button type="button" onClick={stop} className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2">
              Stop
            </button>
          )}
          {!brands && <span className="text-xs text-muted">loading brand data…</span>}
          {rows.length > 0 && (
            <span className="text-xs tabular text-muted">
              {done.length + failed.length}/{rows.length} · {(elapsed / 1000).toFixed(1)} s · ${cost.toFixed(4)}
              {failed.length > 0 && <> · {failed.length} failed</>}
            </span>
          )}
        </div>
        {rows.length > 0 && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${progress * 100}%`, background: 'var(--accent)' }} />
          </div>
        )}
      </Card>

      {done.length > 0 && (
        <>
          <Card>
            <SectionTitle
              title={running ? 'Filling in…' : 'The audit'}
              sub={`${done.length} quotes · ${(elapsed / 1000).toFixed(1)} seconds · ${tokens.toLocaleString()} input tokens · $${cost.toFixed(4)} total · four questions each`}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Agree with offline label" value={pct(agreeRate)} hint={`${agree.length} of ${done.length} quotes`} />
              <StatTile label="Carry a second signal" value={String(multi.length)} hint="runner-up probability ≥ 25%" />
              <StatTile label="Flagged as spam" value={String(spamHits.length)} hint="the offline taxonomy had no slot for this" />
              <StatTile label="Cost per quote" value={`$${done.length ? (cost / done.length).toFixed(6) : '–'}`} hint={`${done.length ? Math.round(elapsed / done.length) : '–'} ms each, ${CONCURRENCY} in flight`} />
            </div>
          </Card>

          <Card>
            <SectionTitle
              title="How much of this could run unattended?"
              sub="Move the threshold. Above it, Jev's answer is taken as-is; below it, a person looks. The agreement rates tell you whether that split is honest."
            />
            <div className="flex flex-wrap items-center gap-4">
              <label htmlFor="thr" className="text-sm text-ink-2">
                Confidence threshold <span className="tabular font-medium text-ink">{pct(threshold)}</span>
              </label>
              <input id="thr" type="range" min={0.3} max={0.99} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-64 accent-[var(--accent)]" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="text-xs text-ink-2">Auto-route (confidence ≥ {pct(threshold)})</div>
                <div className="mt-1 text-2xl font-semibold tabular text-ink">{done.length ? pct(confident.length / done.length) : '–'}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {confident.length} quotes · agrees with offline label {pct(agreeConfident)} of the time
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="text-xs text-ink-2">Send to a person (below {pct(threshold)})</div>
                <div className="mt-1 text-2xl font-semibold tabular text-ink">{done.length ? pct(unsure.length / done.length) : '–'}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {unsure.length} quotes · agrees with offline label {pct(agreeUnsure)} of the time
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              If the confident bucket agrees far more often than the unsure one, the confidence number means something —
              and the unsure bucket is exactly the set of comments where two reasonable people would also disagree. That
              is what a text-generating classifier cannot give you: it hands back one label and no way to know which
              ones to double-check.
            </p>
          </Card>

          <Card>
            <SectionTitle title="Offline label vs Jev" sub="Rows: what the gpt-5.2 batch job said. Columns: what Jev says now. The diagonal is agreement." />
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-surface py-1 pr-2 text-left font-medium text-ink-2">offline ↓ / Jev →</th>
                    {DIMENSION_KEYS.map((k) => (
                      <th key={k} className="px-1 py-1 text-center font-normal text-muted" title={DIMENSION_LABELS[k]}>
                        <span className="inline-block max-w-[52px] truncate align-bottom">{DIMENSION_LABELS[k].split(' ')[0]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DIMENSION_KEYS.map((row) => (
                    <tr key={row}>
                      <th className="sticky left-0 bg-surface py-0.5 pr-2 text-left font-medium text-ink-2">{DIMENSION_LABELS[row]}</th>
                      {DIMENSION_KEYS.map((col) => {
                        const n = matrix[row][col]
                        const a = n / matrixMax
                        return (
                          <td key={col} className="p-0.5">
                            <div
                              className={`flex h-7 items-center justify-center rounded tabular ${n ? 'text-ink' : 'text-muted/40'} ${row === col ? 'ring-1 ring-inset ring-axis' : ''}`}
                              style={{ background: n ? `color-mix(in oklab, var(--accent) ${Math.round(15 + a * 70)}%, var(--surface-2))` : 'var(--surface-2)' }}
                              title={`${DIMENSION_LABELS[row]} → ${DIMENSION_LABELS[col]}: ${n}`}
                            >
                              {n || ''}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionTitle title="Look at the quotes" sub="The aggregate is only as good as the individual calls. Read them." />
            <div className="mb-3 flex flex-wrap gap-2">
              {(
                [
                  ['disagree', `Disagreements (${disagreements.length})`],
                  ['multi', `Two signals (${multi.length})`],
                  ['spam', `Spam (${spamHits.length})`],
                  ['calls', 'Top call list'],
                  ['urgent', 'Most urgent'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${view === k ? 'border-ink bg-ink text-page' : 'border-border bg-surface text-ink hover:bg-surface-2'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-2">
              {view === 'disagree' &&
                (disagreements.length === 0 ? (
                  <p className="text-sm text-muted">No disagreements yet.</p>
                ) : (
                  disagreements.slice(0, 30).map((r, i) => {
                    const d = dim(r)!
                    return (
                      <Quote
                        key={i}
                        text={r.text}
                        meta={`${r.brand} · ${r.platform} · offline said ${DIMENSION_LABELS[r.offline]} · Jev says ${DIMENSION_LABELS[d.choice] ?? d.choice} at ${pct(d.probabilities[d.choice] ?? 0)}, confidence ${pct(d.confidence ?? 0)}`}
                      />
                    )
                  })
                ))}
              {view === 'multi' &&
                (multi.length === 0 ? (
                  <p className="text-sm text-muted">No two-signal quotes yet.</p>
                ) : (
                  multi.slice(0, 30).map(({ r, t2 }, i) => (
                    <Quote
                      key={i}
                      text={r.text}
                      meta={`${r.brand} · ${r.platform} · ${DIMENSION_LABELS[t2[0][0]]} ${pct(t2[0][1])} and ${DIMENSION_LABELS[t2[1][0]]} ${pct(t2[1][1])} · offline kept only ${DIMENSION_LABELS[r.offline]}`}
                    />
                  ))
                ))}
              {view === 'spam' &&
                (spamHits.length === 0 ? (
                  <p className="text-sm text-muted">No spam flagged in this scope.</p>
                ) : (
                  spamHits.map((r, i) => <Quote key={i} text={r.text} meta={`${r.brand} · ${r.platform} · spam ${pct(spam(r))} · offline filed it as ${DIMENSION_LABELS[r.offline]}`} />)
                ))}
              {view === 'calls' &&
                callList.map((r, i) => (
                  <Quote key={i} text={r.text} meta={`${r.brand} · ${r.platform} · worth a call ${pct(call(r))} · ${DIMENSION_LABELS[dim(r)?.choice ?? ''] ?? ''}`} />
                ))}
              {view === 'urgent' &&
                urgentList.map((r, i) => (
                  <Quote key={i} text={r.text} meta={`${r.brand} · ${r.platform} · urgency ${urg(r).toFixed(2)} / 3 · ${DIMENSION_LABELS[dim(r)?.choice ?? ''] ?? ''}`} />
                ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
