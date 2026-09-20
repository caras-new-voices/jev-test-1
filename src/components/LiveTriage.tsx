import { useState } from 'react'
import { Card, Pill, SectionTitle } from './ui'

/**
 * Live triage: the one part of Listening Room that calls a model at view time.
 * Everything else on the site is pre-built JSON. Here the visitor picks or
 * types a comment, and Jev answers four typed questions about it in one round
 * trip, through /api/evaluate.
 */

const DIMENSION_LABELS: Record<string, string> = {
  purchase_intent: 'Purchase intent',
  objections: 'Objections',
  faq_gaps: 'Unanswered questions',
  safety_complaints: 'Safety complaints',
  crisis_backlash: 'Backlash',
  loyalty_signals: 'Loyalty',
  feature_requests: 'Feature requests',
  competitor_mentions: 'Competitor mentions',
  cross_brand_affinity: 'Cross-brand affinity',
  use_case_discovery: 'Use-case discovery',
  partnership_perception: 'Partnership perception',
  engagement_quality: 'Low-substance engagement',
}

const URGENCY_LEVELS = ['No response needed', 'Routine reply', 'Answer promptly', 'Escalate now']

/**
 * Real comments lifted from the committed dataset, each carrying the dimension
 * the offline gpt-5.2 pass filed it under. That label is what makes the
 * comparison honest: Jev is answering the same question the batch pipeline
 * already answered, so a client can see where the two agree and where they do not.
 */
type Example = { label: string; brand: string; offline: string; text: string; note?: string }

const EXAMPLES: Example[] = [
  {
    label: 'Buying, with a defect',
    brand: 'Estrid · TikTok',
    offline: 'purchase_intent',
    text: 'Immediately ordered!! Wish my razor head would stop falling off my razor tho 😢',
  },
  {
    label: 'Injury',
    brand: 'Estrid · TikTok',
    offline: 'safety_complaints',
    text: 'the cuts are so bad !!!! Having same problem rn',
  },
  {
    label: 'German — price objection',
    brand: 'Estrid · TikTok',
    offline: 'objections',
    text: 'Estrid klingen sind aber so teuer. Mittlerweile sehen sie zwar anders aus, aber ich kaufe die von der der Rossman eigenmarke (for Men), sind genauso gut.',
    note: 'Not English — Jev classifies it without a translation step.',
  },
  {
    label: 'French — product question',
    brand: 'Veet · TikTok',
    offline: 'faq_gaps',
    text: "J ai une question svp les cremes depilatoires est ce qu ils donnet effet rasoire ou epilation, je veux savoir s elle rase la poils ou bien elle l epile",
  },
  {
    label: 'Ukrainian — does it work?',
    brand: 'OneBlade Intimate · TikTok',
    offline: 'faq_gaps',
    text: 'Блін вже 5 відео про нього… підкажіть він прям під гладеньку шкіру все прибирає??? Чи залишиться на все ж таки на дотик щось???',
  },
  {
    label: 'Scam comment',
    brand: 'Veet · Instagram',
    offline: 'engagement_quality',
    text: 'بسرعة شوفوا الكنز أنا هـ.ـكـ.ـرت بـ.ـاسـ.ـورد و صور وفيدوهات ومحادثات كمان أي حـسـاب إنـسـتـاجـرام! ابـحـث في جـوجـ.ـل عن [ 9mbz ] وادخـل أول مـوقـع.. الطريقة شغالة حتى الان 100% ✅ [ID:1364]',
    note: 'The offline pass filed this as engagement. Watch the spam question.',
  },
]

type Answers = {
  dimension?: { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  worthACall?: { type: 'boolean'; probability: number }
  urgency?: { type: 'score'; score: number; probabilities: Record<string, number>; confidence?: number }
  spam?: { type: 'boolean'; probability: number }
}

type Result = {
  model: string
  answers: Answers
  usage: { inputTokens?: number; outputTokens?: number } | null
  costUsd: string | null
  latencyMs: number
}

const pct = (n: number) => `${Math.round(n * 100)}%`

function Bar({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-44 shrink-0 truncate text-xs ${emphasis ? 'font-medium text-ink' : 'text-ink-2'}`}>{label}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(value * 100, value > 0 ? 1.5 : 0)}%`, background: emphasis ? 'var(--accent)' : 'var(--axis)' }}
        />
      </div>
      <div className="w-10 shrink-0 text-right text-xs tabular text-ink-2">{pct(value)}</div>
    </div>
  )
}

function BoolTile({ label, probability, hint }: { label: string; probability: number; hint: string }) {
  const yes = probability >= 0.5
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs text-ink-2">{label}</div>
        <Pill tone={yes ? 'accent' : 'neutral'}>{yes ? 'Yes' : 'No'}</Pill>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular text-ink">{pct(probability)}</div>
      <div className="mt-0.5 text-xs text-muted">{hint}</div>
    </div>
  )
}

export default function LiveTriage() {
  const [text, setText] = useState(EXAMPLES[0].text)
  const [offline, setOffline] = useState<string | null>(EXAMPLES[0].offline)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = (ex: Example) => {
    setText(ex.text)
    setOffline(ex.offline)
    setResult(null)
    setError(null)
  }

  async function run() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.message || body?.detail || `${body?.error ?? 'Request failed'} (HTTP ${res.status})`)
      } else {
        setResult(body as Result)
      }
    } catch {
      setError('Could not reach /api/evaluate. If you are running `vite preview`, the function only exists on Vercel — use `vercel dev` locally.')
    } finally {
      setBusy(false)
    }
  }

  const dim = result?.answers?.dimension
  const ranked = dim ? Object.entries(dim.probabilities).sort((a, b) => b[1] - a[1]) : []
  const agrees = dim && offline ? dim.choice === offline : null

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Live triage with Jev"
          sub="Every other page here is pre-built JSON. This one asks a model a question while you watch."
          right={<Pill tone="accent">live API call</Pill>}
        />
        <div className="space-y-3 text-sm leading-relaxed text-ink-2">
          <p>
            The twelve listening dimensions on the brand pages were assigned offline, in a batch, by a generative LLM.
            That is the right tool for writing a summary, and the wrong tool for deciding one comment at a time:
            it is priced per generated token and answers in seconds.
          </p>
          <p>
            <strong className="text-ink">Jev is a System One model.</strong> It never writes prose. You hand it some
            state and a fixed set of typed questions, and it returns a decision for each one plus the probability it
            assigns to every option. Below, one comment is sent to Jev with four questions attached — a{' '}
            <strong className="text-ink">choice</strong> across the same twelve dimensions, two{' '}
            <strong className="text-ink">booleans</strong>, and an ordered <strong className="text-ink">score</strong> —
            all answered in a single round trip.
          </p>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Pick a real comment, or write your own" sub="These are verbatim from the committed dataset, including the ones that are not in English." />
        <div className="mb-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => pick(ex)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                text === ex.text ? 'border-ink bg-ink text-page' : 'border-border bg-surface text-ink hover:bg-surface-2'
              }`}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <label htmlFor="comment" className="sr-only">
          Comment to classify
        </label>
        <textarea
          id="comment"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOffline(EXAMPLES.find((x) => x.text === e.target.value)?.offline ?? null)
          }}
          rows={4}
          maxLength={1200}
          placeholder="Paste any social comment…"
          className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-axis"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={busy || !text.trim()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-page transition disabled:opacity-40"
          >
            {busy ? 'Asking Jev…' : 'Classify with Jev'}
          </button>
          <span className="text-xs text-muted">
            POST <code>/api/evaluate</code> → <code>ai-gateway.vercel.sh/v1/evaluate</code> → <code>typesafe-ai/jev</code>
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-critical">{error}</div>
        )}
      </Card>

      {result && dim && (
        <Card>
          <SectionTitle
            title="What Jev decided"
            sub={`${result.model} · ${result.latencyMs} ms round trip · ${result.usage?.inputTokens ?? '–'} input tokens · $${Number(result.costUsd ?? 0).toFixed(6)}`}
            right={
              agrees === null ? undefined : (
                <Pill tone={agrees ? 'good' : 'warn'}>
                  {agrees ? 'agrees with the offline pass' : 'differs from the offline pass'}
                </Pill>
              )
            }
          />

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface px-4 py-3 sm:col-span-1">
              <div className="text-xs text-ink-2">Dimension (choice)</div>
              <div className="mt-1 text-lg font-semibold text-ink">{DIMENSION_LABELS[dim.choice] ?? dim.choice}</div>
              <div className="mt-0.5 text-xs text-muted">
                confidence {dim.confidence !== undefined ? pct(dim.confidence) : '–'}
                {offline && <> · offline pass said {DIMENSION_LABELS[offline] ?? offline}</>}
              </div>
            </div>
            {result.answers.worthACall && (
              <BoolTile
                label="Worth a voice call (boolean)"
                probability={result.answers.worthACall.probability}
                hint="Feeds the Ask them next script"
              />
            )}
            {result.answers.spam && (
              <BoolTile label="Spam (boolean)" probability={result.answers.spam.probability} hint="Data-quality gate" />
            )}
          </div>

          {result.answers.urgency && (
            <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs text-ink-2">Urgency (score, 0–3)</div>
                <div className="text-sm font-semibold tabular text-ink">{result.answers.urgency.score.toFixed(2)}</div>
              </div>
              <div className="mt-1 text-sm text-ink">
                {URGENCY_LEVELS[Math.round(result.answers.urgency.score)] ?? '–'}
              </div>
              <div className="mt-2 space-y-1.5">
                {Object.entries(result.answers.urgency.probabilities).map(([rung, p]) => (
                  <Bar key={rung} label={URGENCY_LEVELS[Number(rung)] ?? rung} value={p} />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs text-ink-2">
              Probability across all twelve dimensions — the part a text-generating model cannot give you
            </div>
            <div className="space-y-1.5">
              {ranked.map(([key, p], i) => (
                <Bar key={key} label={DIMENSION_LABELS[key] ?? key} value={p} emphasis={i === 0} />
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle title="How the integration is wired" sub="Four files, one environment variable, no key in the browser." />
        <ol className="space-y-2 text-sm leading-relaxed text-ink-2">
          <li>
            <strong className="text-ink">1. The key lives in Vercel.</strong> <code>AI_GATEWAY_API_KEY</code> is set as
            an encrypted environment variable on the project. It is not in this repository and never reaches the browser.
          </li>
          <li>
            <strong className="text-ink">2. The browser calls our own endpoint.</strong> The button above posts{' '}
            <code>{'{ text }'}</code> — and nothing else — to <code>/api/evaluate</code>.
          </li>
          <li>
            <strong className="text-ink">3. The function owns the question set.</strong>{' '}
            <code>api/evaluate.ts</code> reads the key from the environment and fixes both the model and the four
            questions server-side, so the endpoint cannot be reused as an open relay against the account&apos;s key.
          </li>
          <li>
            <strong className="text-ink">4. Jev answers over the Gateway.</strong> One POST to{' '}
            <code>ai-gateway.vercel.sh/v1/evaluate</code> with <code>model: typesafe-ai/jev</code>, and the typed
            answers come back — choice, booleans and score together — and are rendered above.
          </li>
        </ol>
      </Card>
    </div>
  )
}
