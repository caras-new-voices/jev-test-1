import { useMemo, useState } from 'react'
import { category, shortName } from '../lib/data'
import { compact } from '../lib/format'
import { EvalError, evaluate, optionLabel, pct, pretty } from '../lib/jev'
import { englishFor, useTranslations } from '../lib/translate'
import type { Answer, EvalResult, QuestionSpec } from '../lib/jev'
import { Card, Pill, SectionTitle, StatTile } from './ui'

/**
 * The Jev showcase: the one view in Listening Room that calls a model at view
 * time. Everything else here is pre-built JSON. This page explains the corpus
 * that JSON came from, what Jev is, and then lets a visitor run Jev against any
 * comment — with a ready-made question pack or one they write themselves.
 */

/* ------------------------------------------------------------------- packs */

const PACKS = [
  {
    id: 'triage',
    label: 'Comment triage',
    blurb: 'Reproduces the offline pipeline: which of the twelve dimensions, is it spam, is it urgent, is this person worth a call.',
  },
  {
    id: 'profile',
    label: 'Full 12-dimension profile',
    blurb: 'Twelve booleans in one request. A comment is rarely about one thing; the offline pass had to pick one. This does not.',
  },
  {
    id: 'route',
    label: 'Route and act',
    blurb: 'Turns the same comment into an operational decision: which team owns it, reply publicly or not, what the reply should do, how far up the queue.',
  },
  {
    id: 'screen',
    label: 'Voice-survey screener',
    blurb: 'Screens the commenter as an interview respondent and picks which scripted question to open the call with.',
  },
  {
    id: 'quality',
    label: 'Language and data quality',
    blurb: 'The unglamorous job: what language is this, is it English, is it even about hair removal, is it spam.',
  },
] as const

type PackId = (typeof PACKS)[number]['id']

/* ---------------------------------------------------------------- examples */

/**
 * Real comments from the committed dataset. `offline` is the dimension the
 * batch gpt-5.2 pass filed each one under, which is what makes the comparison
 * on the triage pack honest rather than decorative.
 */
type Example = { label: string; brand: string; offline: string; text: string; why: string }

const EXAMPLES: Example[] = [
  {
    label: 'Buying, with a defect',
    brand: 'Estrid · TikTok',
    offline: 'purchase_intent',
    text: 'Immediately ordered!! Wish my razor head would stop falling off my razor tho 😢',
    why: 'Two signals in one sentence. Watch the probability split between purchase intent and objections — a single label would throw half of this away.',
  },
  {
    label: 'Injury',
    brand: 'Estrid · TikTok',
    offline: 'safety_complaints',
    text: 'the cuts are so bad !!!! Having same problem rn',
    why: 'Eight words, no brand name, no product name. Urgency should still come back high.',
  },
  {
    label: 'German — price objection',
    brand: 'Estrid · TikTok',
    offline: 'objections',
    text: 'Estrid klingen sind aber so teuer. Mittlerweile sehen sie zwar anders aus, aber ich kaufe die von der der Rossman eigenmarke (for Men), sind genauso gut.',
    why: 'Not English, and it names a competitor without naming it as a competitor. No translation step involved.',
  },
  {
    label: 'French — product question',
    brand: 'Veet · TikTok',
    offline: 'faq_gaps',
    text: 'J ai une question svp les cremes depilatoires est ce qu ils donnet effet rasoire ou epilation, je veux savoir s elle rase la poils ou bien elle l epile',
    why: 'Misspelled, unpunctuated, phonetic French. This is what real comment data looks like.',
  },
  {
    label: 'Ukrainian — does it work?',
    brand: 'OneBlade Intimate · TikTok',
    offline: 'faq_gaps',
    text: 'Блін вже 5 відео про нього… підкажіть він прям під гладеньку шкіру все прибирає??? Чи залишиться на все ж таки на дотик щось???',
    why: 'Cyrillic, slang, and an unanswered question buried in the middle.',
  },
  {
    label: 'Loyalty',
    brand: 'Estrid · TikTok',
    offline: 'loyalty_signals',
    text: 'Estrid has been my go-to for literally like 6/7 years 🙏🏼🙌🏼',
    why: 'Positive and genuine — but is there anything a voice interview would learn? Check “worth a call”.',
  },
  {
    label: 'Scam comment',
    brand: 'Veet · Instagram',
    offline: 'engagement_quality',
    text: 'بسرعة شوفوا الكنز أنا هـ.ـكـ.ـرت بـ.ـاسـ.ـورد و صور وفيدوهات ومحادثات كمان أي حـسـاب إنـسـتـاجـرام! ابـحـث في جـوجـ.ـل عن [ 9mbz ] وادخـل أول مـوقـع.. الطريقة شغالة حتى الان 100% ✅ [ID:1364]',
    why: 'An account-hacking scam, deliberately obfuscated with dots. The offline pass filed it as ordinary engagement because its taxonomy had no slot for spam. Jev has one.',
  },
]

/* ----------------------------------------------------------------- results */

type Result = EvalResult

function Bar({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-48 shrink-0 truncate text-xs ${emphasis ? 'font-medium text-ink' : 'text-ink-2'}`} title={label}>
        {label}
      </div>
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

/** Renders whichever of the three answer shapes came back, for any question. */
function AnswerBlock({ name, spec, answer }: { name: string; spec?: QuestionSpec; answer: Answer }) {
  const title = pretty(name)

  if (answer.type === 'boolean') {
    const yes = answer.probability >= 0.5
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-ink">{title}</div>
          <Pill tone={yes ? 'accent' : 'neutral'}>{yes ? 'Yes' : 'No'}</Pill>
        </div>
        <div className="mt-1 text-2xl font-semibold tabular text-ink">{pct(answer.probability)}</div>
        <div className="mt-0.5 text-xs text-muted">boolean · probability of true</div>
        {spec && <div className="mt-1 text-xs text-ink-2">{spec.instructions}</div>}
      </div>
    )
  }

  if (answer.type === 'score') {
    const rungs = spec && spec.type === 'score' ? spec.criteria : []
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-ink">{title}</div>
          <div className="text-sm font-semibold tabular text-ink">{answer.score.toFixed(2)}</div>
        </div>
        <div className="mt-0.5 text-sm text-ink">{rungs[Math.round(answer.score)] ?? ''}</div>
        <div className="mt-0.5 text-xs text-muted">
          score · 0–{Math.max(rungs.length - 1, 1)}
          {answer.confidence !== undefined && <> · confidence {pct(answer.confidence)}</>}
        </div>
        <div className="mt-2 space-y-1.5">
          {Object.entries(answer.probabilities).map(([rung, p]) => (
            <Bar key={rung} label={rungs[Number(rung)] ?? `level ${rung}`} value={p} />
          ))}
        </div>
      </div>
    )
  }

  const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-ink">{title}</div>
        <Pill tone="accent">{optionLabel(answer.choice, spec)}</Pill>
      </div>
      <div className="mt-0.5 text-xs text-muted">
        choice · {ranked.length} options
        {answer.confidence !== undefined && <> · confidence {pct(answer.confidence)}</>}
      </div>
      {spec && <div className="mt-1 text-xs text-ink-2">{spec.instructions}</div>}
      <div className="mt-2 space-y-1.5">
        {ranked.map(([key, p], i) => (
          <Bar key={key} label={optionLabel(key, spec)} value={p} emphasis={i === 0} />
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- the screen */

export default function LiveTriage() {
  useTranslations()
  const [text, setText] = useState(EXAMPLES[0].text)
  const [active, setActive] = useState<Example | null>(EXAMPLES[0])
  const [pack, setPack] = useState<PackId>('triage')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Custom question builder
  const [custom, setCustom] = useState(false)
  const [cName, setCName] = useState('buysWithin30Days')
  const [cType, setCType] = useState<'choice' | 'boolean' | 'score'>('boolean')
  const [cInstructions, setCInstructions] = useState('Is this person likely to buy within the next 30 days?')
  const [cOptions, setCOptions] = useState('definitely_not: no intent at all\nmaybe: some interest\nlikely: clear intent to buy')

  const totals = useMemo(() => {
    const b = category.brands
    return {
      posts: b.reduce((s, x) => s + x.metrics.posts, 0),
      creators: b.reduce((s, x) => s + x.metrics.influencers, 0),
      emv: b.reduce((s, x) => s + x.metrics.emv, 0),
      impressions: b.reduce((s, x) => s + x.metrics.impressions, 0),
    }
  }, [])

  const pick = (ex: Example) => {
    setText(ex.text)
    setActive(ex)
    setResult(null)
    setError(null)
  }

  /** Turn the builder fields into the question object the API validates. */
  function buildCustomQuestion(): Record<string, QuestionSpec> | string {
    const name = cName.trim()
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) return 'Name must start with a letter and use only letters, digits or underscores.'
    const instructions = cInstructions.trim()
    if (!instructions) return 'Give the question some instructions.'
    if (cType === 'boolean') return { [name]: { type: 'boolean', instructions } }

    const lines = cOptions.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return 'Give at least two options, one per line.'
    if (cType === 'score') return { [name]: { type: 'score', instructions, criteria: lines } }

    const criteria: Record<string, string> = {}
    for (const line of lines) {
      const i = line.indexOf(':')
      if (i < 1) return `Choice options need "key: description" — got "${line.slice(0, 30)}".`
      criteria[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    if (Object.keys(criteria).length < 2) return 'Give at least two distinct options.'
    return { [name]: { type: 'choice', instructions, criteria } }
  }

  async function run() {
    if (!text.trim() || busy) return
    let payload: Record<string, unknown> = { text, pack }
    if (custom) {
      const built = buildCustomQuestion()
      if (typeof built === 'string') {
        setError(built)
        return
      }
      payload = { text, questions: built }
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await evaluate(payload))
    } catch (e) {
      setError(
        e instanceof EvalError
          ? e.message
          : 'Could not reach /api/evaluate. Under `vite preview` the function does not exist — use `vercel dev`, or the deployed site.',
      )
    } finally {
      setBusy(false)
    }
  }

  const dim = result?.answers?.dimension
  const agrees = dim && dim.type === 'choice' && active && result?.pack === 'triage' ? dim.choice === active.offline : null

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------ 1. the corpus */}
      <Card>
        <SectionTitle
          title="What this page is"
          sub="Listening Room is a static report. This page is the one place it stops being static and asks a model a question while you watch."
          right={<Pill tone="accent">live API call</Pill>}
        />
        <p className="text-sm leading-relaxed text-ink-2">
          Three demonstrations, in the tabs above. This one works on a single comment: the dataset the report was built
          from, what Jev is and how this site is connected to it, five ready-made jobs, and a box to write your own
          question. <strong className="text-ink">The whole report</strong> re-classifies every quote in the report live
          and audits the offline pass. <strong className="text-ink">A live call</strong> lets Jev choose the next
          scripted question between voice turns. Nothing is pre-recorded — every answer is fetched when you press a
          button.
        </p>
      </Card>

      <Card>
        <SectionTitle
          title="The dataset we started with"
          sub={`Brandwatch export ${category.generatedFrom} · ${category.category} · October 2025 to August 2026`}
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Creator posts" value={compact(totals.posts)} hint="across TikTok, Instagram, YouTube" />
          <StatTile label="Unique creators" value={compact(totals.creators)} hint="six competing brands" />
          <StatTile label="Earned media value" value={`$${compact(totals.emv)}`} hint="sum of the six segments" />
          <StatTile label="Audience comments" value="19.9K" hint="sampled and classified offline" />
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-ink-2">
          <p>
            Six brands were tracked as separate Brandwatch query segments —{' '}
            {category.brands.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ', '}
                <strong className="text-ink">{shortName(b.name)}</strong>
              </span>
            ))}{' '}
            — capturing every creator post that mentioned them, plus the replies underneath. Two things came out of
            that export: <strong className="text-ink">post-level metrics</strong> (reach, engagement, EMV, paid
            disclosure, creator tier) and a <strong className="text-ink">sample of ~19,900 audience comments</strong>.
          </p>
          <p>
            The comments are the interesting half, and the messy half. They arrive in at least ten languages — English,
            Italian, German, French, Polish, Spanish, Dutch, Ukrainian, Russian, Arabic — riddled with typos, emoji,
            slang and outright spam. A batch job run by a generative LLM (<code>gpt-5.2</code>, recorded in the{' '}
            <code>model</code> field of every comments file) sorted a sample of them into twelve listening dimensions
            and pulled 512 verbatim quotes. That frozen output is what every other page in this report renders.
          </p>
          <p>
            That batch approach has two costs. It is <strong className="text-ink">expensive per comment</strong>, so
            only a sample was classified rather than all of it. And it is <strong className="text-ink">frozen</strong>:
            a new comment arriving today gets nothing until someone re-runs the job. Jev is what you use when you want
            the same judgement continuously, per comment, cheaply enough not to think about it.
          </p>
        </div>
      </Card>

      {/* --------------------------------------------------------- 2. what Jev is */}
      <Card>
        <SectionTitle title="What Jev is, and what it will not do" sub="TypeSafe AI's Jev, reached through the Vercel AI Gateway as typesafe-ai/jev." />
        <div className="mb-4 space-y-3 text-sm leading-relaxed text-ink-2">
          <p>
            Jev is a <strong className="text-ink">System One model</strong>. The distinction that matters: it does not
            generate text. There is no prompt to engineer, no output to parse, no chance of it inventing a category you
            did not define. You hand it some state and a set of typed questions; it returns a decision for each
            question and the probability it assigned to every possible answer.
          </p>
          <p>
            That constraint is the point. Because the answer space is fixed in advance, the response is always valid,
            always the same shape, and always carries its own uncertainty — so you can route on{' '}
            <em>“0.99 confident it is a safety complaint”</em> differently from <em>“0.41, and it is a coin flip”</em>.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { t: 'Choice', d: 'Pick one option from a named set of up to 255. Returns the winner, a probability for every option, and a confidence.', e: 'Which of the twelve listening dimensions is this?' },
            { t: 'Boolean', d: 'Returns the probability that a statement is true, from 0 to 1. Optionally define what true and false mean.', e: 'Is this person worth a phone call?' },
            { t: 'Score', d: 'Rate against an ordered rubric of 2–10 rungs. Returns an interpolated score plus the probability of each rung.', e: 'How urgently must the brand respond?' },
          ].map((p) => (
            <div key={p.t} className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="text-sm font-semibold text-ink">{p.t}</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-2">{p.d}</div>
              <div className="mt-2 border-t border-border pt-2 text-xs italic text-muted">{p.e}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Questions of different types can share one piece of state and be answered in a{' '}
          <strong className="text-ink">single round trip</strong>. Every pack below asks four at once. Typical response
          for this corpus: a few hundred milliseconds and a cost in the tens of microdollars — the exact figures come
          back with each answer, so you can read them off the panel rather than take our word for it.
        </p>
      </Card>

      {/* ---------------------------------------------------------- 3. try it */}
      <Card>
        <SectionTitle title="Pick a comment" sub="Verbatim from the committed dataset — including the ones that are not in English, and one that is not a real person." />
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
          Comment to evaluate
        </label>
        <textarea
          id="comment"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(EXAMPLES.find((x) => x.text === e.target.value) ?? null)
          }}
          rows={4}
          maxLength={1200}
          placeholder="…or paste any comment, in any language, and see what comes back."
          className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-axis"
        />
        {englishFor(text) && (
          <p className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-ink-2">
            <span className="font-medium text-ink">In English:</span> {englishFor(text)}
            <span className="mt-1 block text-muted">
              Jev is sent the original above, untranslated — it reads every language natively, so nothing is translated before it decides.
            </span>
          </p>
        )}
        {active && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            <strong className="text-ink-2">{active.brand}</strong> — {active.why}
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Choose what to ask about it"
          sub="The same comment, the same model — five different jobs, each answered in one request."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPack(p.id)
                setCustom(false)
                setResult(null)
              }}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                !custom && pack === p.id ? 'border-ink bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'
              }`}
            >
              <div className="text-sm font-medium text-ink">{p.label}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-2">{p.blurb}</div>
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-border bg-surface">
          <button
            type="button"
            onClick={() => {
              setCustom(!custom)
              setResult(null)
            }}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <div className="text-sm font-medium text-ink">Or write your own question</div>
              <div className="mt-0.5 text-xs text-ink-2">
                Any question you can express as a choice, a boolean or a score — about this corpus or anything else.
              </div>
            </div>
            <Pill tone={custom ? 'accent' : 'neutral'}>{custom ? 'on' : 'off'}</Pill>
          </button>

          {custom && (
            <div className="space-y-3 border-t border-border px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {(['boolean', 'choice', 'score'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCType(t)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      cType === t ? 'border-ink bg-ink text-page' : 'border-border bg-surface text-ink hover:bg-surface-2'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <label htmlFor="q-name" className="mb-1 block text-xs text-ink-2">
                    Answer key
                  </label>
                  <input
                    id="q-name"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-axis"
                  />
                </div>
                <div>
                  <label htmlFor="q-instructions" className="mb-1 block text-xs text-ink-2">
                    Question
                  </label>
                  <input
                    id="q-instructions"
                    value={cInstructions}
                    onChange={(e) => setCInstructions(e.target.value)}
                    maxLength={300}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-axis"
                  />
                </div>
              </div>
              {cType !== 'boolean' && (
                <div>
                  <label htmlFor="q-options" className="mb-1 block text-xs text-ink-2">
                    {cType === 'choice' ? 'Options, one per line as “key: description” (2–12)' : 'Rungs, one per line, lowest first (2–10)'}
                  </label>
                  <textarea
                    id="q-options"
                    value={cOptions}
                    onChange={(e) => setCOptions(e.target.value)}
                    rows={4}
                    className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none focus:border-axis"
                  />
                </div>
              )}
              <p className="text-xs text-muted">
                The server caps this at {5} questions, 12 options and 300 characters of instructions per question. Jev
                cannot return free text, so the answer always lands in the shape you asked for.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={busy || !text.trim()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-page transition disabled:opacity-40"
          >
            {busy ? 'Asking Jev…' : custom ? 'Ask my question' : `Run “${PACKS.find((p) => p.id === pack)?.label}”`}
          </button>
          <span className="text-xs text-muted">
            POST <code>/api/evaluate</code> → <code>ai-gateway.vercel.sh/v1/evaluate</code> → <code>typesafe-ai/jev</code>
          </span>
        </div>

        {error && <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-critical">{error}</div>}
      </Card>

      {/* --------------------------------------------------------- 4. results */}
      {result && (
        <Card>
          <SectionTitle
            title="What Jev decided"
            sub={`${result.model} · ${result.latencyMs} ms round trip · ${result.usage?.inputTokens ?? '–'} input tokens · $${Number(
              result.costUsd ?? 0,
            ).toFixed(6)} · ${Object.keys(result.answers).length} questions in one request`}
            right={
              agrees === null ? undefined : (
                <Pill tone={agrees ? 'good' : 'warn'}>{agrees ? 'agrees with the offline pass' : 'differs from the offline pass'}</Pill>
              )
            }
          />
          {agrees !== null && active && (
            <p className="mb-3 text-xs text-muted">
              The batch <code>gpt-5.2</code> pass filed this comment under{' '}
              <strong className="text-ink-2">{pretty(active.offline)}</strong>.
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {Object.entries(result.answers).map(([name, answer]) => (
              <AnswerBlock key={name} name={name} spec={result.questions?.[name]} answer={answer} />
            ))}
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------------- 5. wiring */}
      <Card>
        <SectionTitle title="How this site is connected to Jev" sub="One function, one environment variable, no key in the browser." />
        <pre className="mb-4 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
{`browser  ──POST { text, pack }──▶  /api/evaluate  ──POST──▶  ai-gateway.vercel.sh/v1/evaluate
                                   Vercel Edge Function        model: typesafe-ai/jev
                                   reads AI_GATEWAY_API_KEY`}
        </pre>
        <ol className="space-y-2 text-sm leading-relaxed text-ink-2">
          <li>
            <strong className="text-ink">1. The key lives in Vercel.</strong> <code>AI_GATEWAY_API_KEY</code> is an
            encrypted environment variable on the project. It is not in the repository and never reaches the browser.
          </li>
          <li>
            <strong className="text-ink">2. The browser calls our own endpoint.</strong> The button posts the comment
            text and either a pack name or a validated question set — never a model name, never a key.
          </li>
          <li>
            <strong className="text-ink">3. The function is the trust boundary.</strong>{' '}
            <code>api/evaluate.ts</code> pins the model, owns the four packs, and validates any custom question against
            hard caps before forwarding it.
          </li>
          <li>
            <strong className="text-ink">4. Jev answers over the Gateway.</strong> One POST to{' '}
            <code>/v1/evaluate</code>, and the typed answers come back together with token usage and cost, which are
            printed above each result.
          </li>
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Swapping the Gateway for TypeSafe directly is a one-line change: the same request shape works against{' '}
          <code>api.typesafe.ai/v1/systemone</code> with a TypeSafe key.
        </p>
      </Card>

      {/* -------------------------------------------------------- 6. open ended */}
      <Card>
        <SectionTitle title="Where this goes next" sub="Nothing above is the ceiling — it is four packs and a text box." />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Classify the whole corpus, not a sample', 'The offline pass could only afford a sample of the ~19,900 comments. At Jev’s per-comment cost, every comment in the export gets all twelve dimensions, and re-running after a new export is routine rather than a project.'],
            ['Score creators, not just comments', 'Point the same three primitives at the 6.2K posts: is this creator on-brand, how sponsored does this read, would we work with them again.'],
            ['Watch for trouble continuously', 'A boolean for safety complaints and a score for urgency, run on every new comment as it arrives, is a monitor — not a report. Anything over a threshold pages a human.'],
            ['Decide inside the voice agent', 'The Ask them next script is currently fixed. With Jev choosing the next question from what the respondent just said, in the time between turns, it stops being a script and becomes a conversation.'],
            ['Gate on confidence, not vibes', 'Route the confident answers automatically and send only the genuinely ambiguous ones to a person. The probability distribution tells you which is which.'],
            ['Ask something nobody has asked yet', 'Every question above was written in a few lines of JSON. The box on this page is the same interface — if you can name the options, Jev can pick between them.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="text-sm font-medium text-ink">{t}</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-2">{d}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
