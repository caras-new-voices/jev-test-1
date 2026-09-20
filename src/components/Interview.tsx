import { useEffect, useMemo, useRef, useState } from 'react'
import { category, shortName } from '../lib/data'
import { evaluate, optionLabel, pct, DIMENSION_LABELS } from '../lib/jev'
import type { BooleanAnswer, ChoiceAnswer, EvalResult, ScoreAnswer } from '../lib/jev'
import { buildScript } from './AskNext'
import { useAllBrands } from './Compare'
import { BrandChip, Card, Pill, SectionTitle } from './ui'

/**
 * The adaptive interview. The Ask them next page produces a fixed script for
 * each brand. Here the same script becomes a bank, and Jev chooses which line
 * to say next — a scripted question, a fixed probe, or "end the call" — from the
 * transcript so far, in the gap between two voice turns. Every line the
 * interviewer can say was written by a person. Jev never writes one.
 *
 * You play the respondent. Type, or click a canned answer to move fast.
 */

const MAX_TURNS = 8

const PROBE_TEXT: Record<string, string> = {
  probe_more: 'Tell me more about that.',
  probe_why: 'Why do you think that is?',
  probe_then: 'And what did you do next?',
}

/** Plausible respondent lines a presenter can click instead of typing. */
const CANNED = [
  'Honestly I switched because my old razor kept cutting me around the knees. This one hasn’t yet, so far so good.',
  'It’s fine. Bit expensive for what it is. I only bought it because there was a code in the video.',
  'The magnetic wall thing fell off my tiles twice and took the razor with it. I nearly gave up on it then.',
  'I don’t really think about it, I just buy whatever is on offer at the supermarket.',
  'My skin gets really irritated with creams so I stick to blades. I tried the cream once and never again.',
  'Yeah, I’d tell a friend. My sister uses it now because of me actually.',
  'Not sure. I guess I’d go back to what I used before, the disposable ones.',
  'Can we wrap this up? I’m on my lunch break.',
]

type Turn = { speaker: 'interviewer' | 'respondent'; text: string; id?: string }
type Decision = { turn: number; result: EvalResult; chosen: string; chosenText: string }

export default function Interview() {
  const brands = useAllBrands()
  const [brandId, setBrandId] = useState(category.brands[2].id) // Estrid has the richest script
  const brand = brands?.find((b) => b.id === brandId)
  const script = useMemo(() => (brand ? buildScript(brand) : null), [brand])

  const [transcript, setTranscript] = useState<Turn[]>([])
  const [asked, setAsked] = useState<string[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [debrief, setDebrief] = useState<EvalResult | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const bank = useMemo(
    () => (script ? script.questions.map((q, i) => ({ id: `q${i + 1}`, theme: q.theme, text: q.ask })) : []),
    [script],
  )

  function reset(nextBrand?: number) {
    if (nextBrand !== undefined) setBrandId(nextBrand)
    setTranscript([])
    setAsked([])
    setDecisions([])
    setDraft('')
    setError(null)
    setEnded(false)
    setDebrief(null)
  }

  // Open the call once the script exists (or the brand changes).
  useEffect(() => {
    if (script && transcript.length === 0) setTranscript([{ speaker: 'interviewer', text: script.intro, id: 'intro' }])
  }, [script, transcript.length])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [transcript, busy])

  const respondentTurns = transcript.filter((t) => t.speaker === 'respondent').length
  const lastWasProbe = transcript.length > 0 && (transcript[transcript.length - 1].id ?? '').startsWith('probe_')

  async function say(text: string) {
    const reply = text.trim()
    if (!reply || busy || ended || !script) return
    setError(null)
    setDraft('')
    const next: Turn[] = [...transcript, { speaker: 'respondent', text: reply }]
    setTranscript(next)
    setBusy(true)

    const remaining = bank.filter((q) => !asked.includes(q.id))
    const mustEnd = respondentTurns + 1 >= MAX_TURNS || remaining.length === 0

    try {
      const state = {
        brand: shortName(brand!.name),
        turn: respondentTurns + 1,
        transcript: next.map((t) => ({ speaker: t.speaker, text: t.text })),
      }
      const result = await evaluate({
        pack: 'interview',
        state,
        bank: remaining.map((q) => ({ id: q.id, text: q.text })),
        allowProbes: !lastWasProbe,
      })
      const choice = result.answers.next as ChoiceAnswer
      let chosen = choice.choice
      if (mustEnd && !remaining.some((q) => q.id === chosen) && !chosen.startsWith('probe_')) chosen = 'end'
      if (mustEnd && chosen.startsWith('probe_')) chosen = 'end'

      let line: Turn
      if (chosen === 'end') {
        line = { speaker: 'interviewer', text: script.close, id: 'close' }
      } else if (chosen.startsWith('probe_')) {
        line = { speaker: 'interviewer', text: PROBE_TEXT[chosen] ?? 'Tell me more.', id: chosen }
      } else {
        const q = bank.find((b) => b.id === chosen) ?? remaining[0]
        chosen = q.id
        line = { speaker: 'interviewer', text: q.text, id: q.id }
        setAsked((a) => [...a, q.id])
      }
      setDecisions((d) => [...d, { turn: respondentTurns + 1, result, chosen, chosenText: line.text }])
      setTranscript((t) => [...t, line])

      if (chosen === 'end') {
        setEnded(true)
        const full = [...next, line].map((t) => ({ speaker: t.speaker, text: t.text }))
        const db = await evaluate({ pack: 'debrief', state: { brand: shortName(brand!.name), transcript: full } })
        setDebrief(db)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const last = decisions[decisions.length - 1]
  const totalMs = decisions.reduce((s, d) => s + d.result.latencyMs, 0)
  const totalCost = decisions.reduce((s, d) => s + Number(d.result.costUsd ?? 0), 0) + Number(debrief?.costUsd ?? 0)

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Let Jev run the call"
          sub="Ask them next builds a fixed script for each brand. Here the script becomes a bank, and Jev decides — between turns — which line to say next."
          right={<Pill tone="accent">live · adaptive</Pill>}
        />
        <div className="space-y-3 text-sm leading-relaxed text-ink-2">
          <p>
            An outbound voice call has a hard constraint a chatbot does not: the gap between the respondent finishing a
            sentence and the interviewer starting one is about half a second before it feels wrong. A generative model
            needs two to five seconds to write a question — and might write one that is off-script, leading, or not
            something the research team approved.
          </p>
          <p>
            Jev fits in the gap because it does not write anything. Every line below was written by a person: the
            brand’s scripted questions, three fixed follow-up probes, and a close.{' '}
            <strong className="text-ink">Jev only chooses</strong>: given everything said so far, which line comes
            next, or is it time to stop? Alongside that choice it reports whether the last answer actually answered
            the question, how engaged the respondent is, and which listening dimension they just touched. Then, when the
            call ends, a second request debriefs the whole transcript.
          </p>
          <p>You are the respondent. Type an answer, or click one of the canned lines to move quickly.</p>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Which brand is calling?" sub="Changes the script bank Jev chooses from." />
        <div className="flex flex-wrap gap-2">
          {category.brands.map((b) => (
            <BrandChip key={b.id} id={b.id} name={b.name} active={b.id === brandId} onClick={() => reset(b.id)} />
          ))}
        </div>
        {bank.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {bank.map((q) => (
              <Pill key={q.id} tone={asked.includes(q.id) ? 'neutral' : 'accent'}>
                {q.id.toUpperCase()} · {q.theme}
                {asked.includes(q.id) && ' ✓'}
              </Pill>
            ))}
            <Pill tone="neutral">3 probes</Pill>
            <Pill tone="neutral">close</Pill>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* ------------------------------------------------------ the call */}
        <Card className="lg:col-span-3">
          <SectionTitle
            title="The call"
            sub={brand ? `${shortName(brand.name)} · turn ${respondentTurns} of up to ${MAX_TURNS}` : 'loading…'}
            right={
              transcript.length > 1 ? (
                <button type="button" onClick={() => reset()} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2">
                  Start over
                </button>
              ) : undefined
            }
          />
          <div ref={logRef} className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {transcript.map((t, i) => (
              <div key={i} className={`flex ${t.speaker === 'respondent' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    t.speaker === 'respondent' ? 'bg-ink text-page' : 'border border-border bg-surface-2 text-ink'
                  }`}
                >
                  {t.speaker === 'interviewer' && t.id && (
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {t.id === 'intro' ? 'open' : t.id === 'close' ? 'close' : t.id.startsWith('probe_') ? 'probe' : bank.find((b) => b.id === t.id)?.theme ?? t.id}
                    </div>
                  )}
                  {t.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">Jev is choosing the next line…</div>
              </div>
            )}
          </div>

          {!ended ? (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {CANNED.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={busy}
                    onClick={() => say(c)}
                    className="max-w-full truncate rounded-full border border-border bg-surface px-2.5 py-1 text-left text-[11px] text-ink-2 transition hover:bg-surface-2 disabled:opacity-40"
                    title={c}
                  >
                    {c.length > 58 ? c.slice(0, 56) + '…' : c}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  say(draft)
                }}
                className="flex gap-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy || !script}
                  placeholder="Answer as the respondent…"
                  className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-axis"
                />
                <button type="submit" disabled={busy || !draft.trim()} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-40">
                  Say it
                </button>
              </form>
              {error && <div className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-critical">{error}</div>}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-2">
              Call ended after {respondentTurns} turns · {decisions.length + (debrief ? 1 : 0)} Jev requests · {totalMs} ms of model time in total ·
              ${totalCost.toFixed(5)}
            </p>
          )}
        </Card>

        {/* -------------------------------------------------- Jev's reasoning */}
        <Card className="lg:col-span-2">
          <SectionTitle title="What Jev decided each turn" sub="Chosen from the bank. Nothing generated." />
          {decisions.length === 0 ? (
            <p className="text-sm text-muted">Answer the opener and the first decision appears here.</p>
          ) : (
            <div className="space-y-3">
              {last && (
                <div className="rounded-lg border border-border bg-surface px-3 py-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-ink">Turn {last.turn}</span>
                    <span className="tabular text-muted">{last.result.latencyMs} ms · ${Number(last.result.costUsd ?? 0).toFixed(6)}</span>
                  </div>
                  {(() => {
                    const n = last.result.answers.next as ChoiceAnswer
                    const ranked = Object.entries(n.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 4)
                    const ans = last.result.answers.answered as BooleanAnswer | undefined
                    const eng = last.result.answers.engagement as ScoreAnswer | undefined
                    const dm = last.result.answers.dimension as ChoiceAnswer | undefined
                    const engRungs = last.result.questions.engagement?.type === 'score' ? last.result.questions.engagement.criteria : []
                    return (
                      <>
                        <div className="text-xs text-ink-2">Next move · confidence {pct(n.confidence ?? 0)}</div>
                        <div className="mt-1 space-y-1">
                          {ranked.map(([k, p], i) => (
                            <div key={k} className="flex items-center gap-2">
                              <div className={`w-28 shrink-0 truncate text-[11px] ${i === 0 ? 'font-medium text-ink' : 'text-ink-2'}`} title={optionLabel(k, last.result.questions.next)}>
                                {k === 'end' ? 'End the call' : k.startsWith('probe_') ? PROBE_TEXT[k] : `${k.toUpperCase()} · ${bank.find((b) => b.id === k)?.theme ?? k}`}
                              </div>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                                <div className="h-full rounded-full" style={{ width: `${Math.max(p * 100, p > 0 ? 1.5 : 0)}%`, background: i === 0 ? 'var(--accent)' : 'var(--axis)' }} />
                              </div>
                              <div className="w-9 text-right text-[11px] tabular text-ink-2">{pct(p)}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                          <div className="rounded-md bg-surface-2 px-2 py-1.5">
                            <div className="text-muted">Answered?</div>
                            <div className="font-medium text-ink">{ans ? `${ans.probability >= 0.5 ? 'Yes' : 'No'} · ${pct(ans.probability)}` : '–'}</div>
                          </div>
                          <div className="rounded-md bg-surface-2 px-2 py-1.5">
                            <div className="text-muted">Engagement</div>
                            <div className="font-medium text-ink" title={engRungs[Math.round(eng?.score ?? 0)]}>{eng ? `${eng.score.toFixed(1)} / 3` : '–'}</div>
                          </div>
                          <div className="rounded-md bg-surface-2 px-2 py-1.5">
                            <div className="text-muted">Touched</div>
                            <div className="truncate font-medium text-ink" title={DIMENSION_LABELS[dm?.choice ?? '']}>{dm ? DIMENSION_LABELS[dm.choice] ?? dm.choice : '–'}</div>
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {decisions.length > 1 && (
                <div>
                  <div className="mb-1 text-xs text-ink-2">Earlier turns</div>
                  <ol className="space-y-1 text-[11px] text-ink-2">
                    {decisions
                      .slice(0, -1)
                      .reverse()
                      .map((d) => {
                        const n = d.result.answers.next as ChoiceAnswer
                        return (
                          <li key={d.turn} className="flex items-baseline justify-between gap-2">
                            <span>
                              Turn {d.turn}: {d.chosen === 'end' ? 'ended' : d.chosen.startsWith('probe_') ? 'probed' : `asked ${d.chosen.toUpperCase()}`} at {pct(n.probabilities[d.chosen] ?? 0)}
                            </span>
                            <span className="tabular text-muted">{d.result.latencyMs} ms</span>
                          </li>
                        )
                      })}
                  </ol>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {debrief && (
        <Card>
          <SectionTitle
            title="Debrief"
            sub={`One more request on the whole transcript · ${debrief.latencyMs} ms · $${Number(debrief.costUsd ?? 0).toFixed(6)} · six questions`}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(debrief.answers).map(([k, a]) => {
              const spec = debrief.questions[k]
              let value = ''
              let hint = ''
              if (a.type === 'choice') {
                value = optionLabel(a.choice, spec)
                hint = `${pct(a.probabilities[a.choice] ?? 0)} · confidence ${pct(a.confidence ?? 0)}`
              } else if (a.type === 'boolean') {
                value = a.probability >= 0.5 ? 'Yes' : 'No'
                hint = pct(a.probability)
              } else {
                const rungs = spec?.type === 'score' ? spec.criteria : []
                value = rungs[Math.round(a.score)] ?? a.score.toFixed(2)
                hint = `${a.score.toFixed(2)} / ${Math.max(rungs.length - 1, 1)}`
              }
              return (
                <div key={k} className="rounded-lg border border-border bg-surface px-4 py-3">
                  <div className="text-xs text-ink-2">{optionLabel(k)}</div>
                  <div className="mt-1 text-base font-semibold text-ink">{value}</div>
                  <div className="mt-0.5 text-xs text-muted">{hint}</div>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Scale this: every call New Voices makes ends with this debrief, in the same shape, for a few
            hundredths of a cent. Six typed fields per respondent means the research output is a table you can sort,
            not a folder of transcripts someone has to read.
          </p>
        </Card>
      )}
    </div>
  )
}
