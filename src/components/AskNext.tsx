import { useMemo, useState } from 'react'
import { category, shortName } from '../lib/data'
import type { Brand, Platform } from '../lib/types'
import { useAllBrands } from './Compare'
import { BrandChip, Card, Pill, Quote, SectionTitle } from './ui'

const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube']

interface Question { theme: string; ask: string; why: string; evidence: string[] }

function collect(b: Brand, key: string) {
  return PLATFORMS.flatMap((p) => {
    const d = b.comments[p]?.dimensions[key]
    return d ? d.items.map((it) => ({ it, quotes: d.top_quotes })) : []
  })
}
function topBy<T>(arr: T[], keyFn: (t: T) => string, n: number) {
  const m = new Map<string, { key: string; n: number; first: T }>()
  for (const t of arr) { const k = keyFn(t); if (!k) continue; const e = m.get(k) ?? { key: k, n: 0, first: t }; e.n++; m.set(k, e) }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, n)
}
const clean = (s: unknown) => String(s ?? '').replace(/_/g, ' ').trim()

/** Build an outbound voice-survey script from the listening evidence. Deterministic: same data, same script. */
export function buildScript(b: Brand): { intro: string; questions: Question[]; close: string } {
  const name = shortName(b.name)
  const faq = topBy(collect(b, 'faq_gaps'), (x) => clean(x.it.topic), 2)
  const obj = topBy(collect(b, 'objections'), (x) => clean(x.it.category), 2)
  const blockers = collect(b, 'purchase_intent').filter((x) => x.it.blocker).slice(0, 3)
  const safety = topBy(collect(b, 'safety_complaints'), (x) => clean(x.it.complaint_type), 1)
  const feat = collect(b, 'feature_requests').slice(0, 2)
  const comp = topBy(collect(b, 'competitor_mentions'), (x) => clean(x.it.competitor_name), 2)
  const loyal = collect(b, 'loyalty_signals').slice(0, 1)
  const qs: Question[] = []

  if (obj.length) {
    const cats = obj.map((o) => o.key).join(' and ')
    qs.push({
      theme: 'Objection check',
      ask: `When you think about ${name}, is there anything about the ${cats} that has ever made you hesitate? Tell me the last time that happened.`,
      why: `The most common objection categories in the comments were “${cats}”. Hearing the story behind the objection tells us whether it is a product problem or a messaging problem.`,
      evidence: obj.flatMap((o) => [String((o.first.it as Record<string, unknown>).verbatim_phrase ?? '')]).filter(Boolean),
    })
  }
  if (faq.length) {
    const topics = faq.map((f) => f.key).join(' or ')
    qs.push({
      theme: 'Unanswered question',
      ask: `People keep asking about ${topics}. Did you ever have that question yourself, and where did you go to find the answer?`,
      why: `“${faq[0].key}” was the most repeated unanswered question under creator posts. If the brand isn’t answering it, someone else is.`,
      evidence: faq.map((f) => String((f.first.it as Record<string, unknown>).representative_phrasing ?? '')).filter(Boolean),
    })
  }
  if (blockers.length) {
    const first = String(blockers[0].it.blocker)
    qs.push({
      theme: 'Purchase friction',
      ask: `Was there ever a moment you were ready to buy ${name} and something got in the way, like ${first.toLowerCase()}? What did you do next?`,
      why: `High-intent comments named concrete blockers. Each one is a lost sale that a script, a link, or a stock fix could recover.`,
      evidence: blockers.map((x) => String(x.it.blocker)),
    })
  }
  if (safety.length) {
    qs.push({
      theme: 'Skin & safety',
      ask: `Some people mentioned ${safety[0].key}. Has anything like that happened to you with ${name}, and what did you change afterwards?`,
      why: `Safety complaints are low in count but high in weight: they are the comments people screenshot. A direct conversation surfaces the usage pattern behind them.`,
      evidence: [`${safety[0].n} flagged ${safety[0].n === 1 ? 'comment' : 'comments'} of this type`],
    })
  }
  if (comp.length) {
    const rival = comp[0].key
    qs.push({
      theme: 'Competitive frame',
      ask: `If ${name} disappeared tomorrow, what would you use instead, and what would you miss? A lot of people mention ${rival}.`,
      why: `${rival} was the most-named alternative in ${name}’s own comment threads. The answer reveals what the brand actually owns versus what the category owns.`,
      evidence: comp.map((c) => `${c.key} named ${c.n}×`),
    })
  }
  if (feat.length) {
    qs.push({
      theme: 'Wish list',
      ask: `If you could change one thing about ${name}, what would it be? Someone suggested “${String(feat[0].it.specific_request ?? '')}”. Would that matter to you?`,
      why: `Feature requests in comments are cheap signal. Testing them in a live conversation separates loud requests from wide ones.`,
      evidence: feat.map((x) => String(x.it.specific_request ?? '')).filter(Boolean),
    })
  }
  const intro = `Hi, this is Emily calling on behalf of a research team working with ${name}. This isn’t a survey, it’s two minutes of me being nosy about how you actually shave. Can I ask you a few quick questions? Every answer is anonymous.`
  const close = loyal.length
    ? `Last one: someone told us “${String((loyal[0].it as Record<string, unknown>).verbatim_phrase ?? '')}”. Does that sound like you, or not at all? Thanks, that was genuinely useful.`
    : `Last one: on a scale from “it’s just a razor” to “I’d tell a friend”, where does ${name} sit for you, and why? Thanks, that was genuinely useful.`
  return { intro, questions: qs.slice(0, 5), close }
}

export default function AskNext() {
  const brands = useAllBrands()
  const [id, setId] = useState(category.brands[0].id)
  const [copied, setCopied] = useState(false)
  const brand = brands?.find((b) => b.id === id)
  const script = useMemo(() => (brand ? buildScript(brand) : null), [brand])

  const text = useMemo(() => {
    if (!script || !brand) return ''
    return [
      `# ${shortName(brand.name)} — outbound voice survey`,
      '', `Opening: ${script.intro}`, '',
      ...script.questions.map((q, i) => `${i + 1}. [${q.theme}] ${q.ask}`),
      '', `Close: ${script.close}`,
    ].join('\n')
  }, [script, brand])

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <SectionTitle title="Turn listening into a conversation" sub="Social listening tells you what people said in public. A two-minute voice call tells you why. This script is assembled from the brand’s own comment evidence: every question points back to the signal that produced it." />
        <div className="flex flex-wrap gap-2">
          {category.brands.map((b) => (
            <BrandChip key={b.id} id={b.id} name={b.name} active={b.id === id} onClick={() => setId(b.id)} />
          ))}
        </div>
      </Card>

      {!script || !brand ? (
        <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <SectionTitle title="The script" sub="Two sentences per turn, the second one always a question" right={<button type="button" onClick={copy} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2">{copied ? 'Copied' : 'Copy script'}</button>} />
            <ol className="grid gap-4">
              <li className="rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-ink"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted">Open</span>{script.intro}</li>
              {script.questions.map((q, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2"><span className="tabular text-xs font-semibold text-muted">Q{i + 1}</span><Pill tone="accent">{q.theme}</Pill></div>
                  <p className="text-sm leading-relaxed text-ink">{q.ask}</p>
                </li>
              ))}
              <li className="rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-ink"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted">Close</span>{script.close}</li>
            </ol>
          </Card>
          <Card className="lg:col-span-2">
            <SectionTitle title="Why each question" sub="The listening evidence behind it" />
            <div className="grid gap-3">
              {script.questions.map((q, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold text-muted">Q{i + 1} · {q.theme}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{q.why}</p>
                  <div className="mt-1.5 grid gap-1">
                    {q.evidence.filter(Boolean).slice(0, 2).map((e, j) => <Quote key={j} text={e} />)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
