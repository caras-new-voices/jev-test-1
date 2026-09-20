/**
 * Shared client-side pieces for talking to /api/evaluate and rendering what Jev
 * sends back. The server owns the question packs; this file only knows how to
 * call it and how to label the answers.
 */

export const DIMENSION_LABELS: Record<string, string> = {
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
export const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS)

/** Readable titles for the answer keys the packs use; custom keys fall back to pretty(). */
export const ANSWER_LABELS: Record<string, string> = {
  dimension: 'Listening dimension',
  worthACall: 'Worth a voice call',
  urgency: 'Urgency',
  spam: 'Spam',
  owner: 'Owning team',
  publicReply: 'Reply publicly',
  tone: 'What the reply should do',
  priority: 'Queue priority',
  goodCandidate: 'Good interview candidate',
  openingQuestion: 'Opening question',
  buyerLikelihood: 'Has actually bought',
  candour: 'Candour',
  language: 'Language',
  isEnglish: 'Written in English',
  onTopic: 'About hair removal',
  next: 'Next move',
  answered: 'Answered the question',
  engagement: 'Engagement',
  status: 'Relationship with the brand',
  churnRisk: 'Risk of leaving',
  driver: 'What drives their choice',
  quoteworthy: 'Quote worth a slide',
  wouldRecommend: 'Would recommend',
  interviewQuality: 'How much we learned',
}

export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
export type BooleanAnswer = { type: 'boolean'; probability: number }
export type ScoreAnswer = { type: 'score'; score: number; probabilities: Record<string, number>; confidence?: number }
export type Answer = ChoiceAnswer | BooleanAnswer | ScoreAnswer

export type QuestionSpec =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: string; criteria: string[] }

export type EvalResult = {
  model: string
  pack: string | null
  questions: Record<string, QuestionSpec>
  answers: Record<string, Answer>
  usage: { inputTokens?: number; outputTokens?: number } | null
  costUsd: string | null
  latencyMs: number
}

export const pct = (n: number) => `${Math.round(n * 100)}%`

/** camelCase / snake_case → sentence case, for keys we have no label for. */
export const pretty = (k: string) =>
  DIMENSION_LABELS[k] ??
  ANSWER_LABELS[k] ??
  k
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())

/**
 * Label one option of a choice question. Prefer our short dimension names, then
 * the criteria description the API echoes back when it is short enough to be a
 * label (e.g. "Ukrainian" for `uk`), and only then the bare key.
 */
export function optionLabel(key: string, spec?: QuestionSpec): string {
  if (DIMENSION_LABELS[key]) return DIMENSION_LABELS[key]
  if (spec?.type === 'choice') {
    const desc = spec.criteria[key]
    if (desc && desc.length <= 32) return desc
  }
  return pretty(key)
}

export class EvalError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** One call to the endpoint. Throws EvalError with the server's message on failure. */
export async function evaluate(body: Record<string, unknown>, signal?: AbortSignal): Promise<EvalResult> {
  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new EvalError(data?.message || data?.detail || `${data?.error ?? 'Request failed'} (HTTP ${res.status})`, res.status)
  return data as EvalResult
}

/** Run `items` through `fn` with at most `limit` in flight, reporting each result as it lands. */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onResult: (index: number, result: R | Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++
      try {
        onResult(i, await fn(items[i], i))
      } catch (e) {
        onResult(i, e instanceof Error ? e : new Error(String(e)))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** The top two options of a choice answer, for spotting comments that carry two signals. */
export function topTwo(a: ChoiceAnswer): [string, number][] {
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2) as [string, number][]
}
