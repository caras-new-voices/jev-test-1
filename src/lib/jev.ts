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
  if (!res.ok) {
    // The function forwards a provider throttle as a 429; older deployments
    // wrapped it in a 502 with the upstream status in the body.
    const status = res.status === 502 && data?.status === 429 ? 429 : res.status
    throw new EvalError(data?.message || data?.detail || `${data?.error ?? 'Request failed'} (HTTP ${res.status})`, status)
  }
  return data as EvalResult
}

export type PoolStats = { inFlight: number; limit: number; throttled: number; retried: number }

/* ------------------------------------------------------- answer cache */

const CACHE_PREFIX = 'jev-answers-v1:'

/** Small non-cryptographic hash, so a quote can key a localStorage entry. */
function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Answers Jev has already given for a (pack, text) pair. Stored per browser so a
 * presenter can warm the audit up before a meeting and still choose a fully live
 * run. Every read and write is wrapped: storage can be absent or full, and the
 * page must work without it.
 */
export function readCached(pack: string, text: string): EvalResult | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + pack + ':' + hashKey(text))
    return raw ? (JSON.parse(raw) as EvalResult) : null
  } catch {
    return null
  }
}

export function writeCached(pack: string, text: string, result: EvalResult): void {
  try {
    localStorage.setItem(CACHE_PREFIX + pack + ':' + hashKey(text), JSON.stringify(result))
  } catch {
    /* storage full or unavailable: the live answer is still on screen */
  }
}

export function clearCached(): number {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX))
    keys.forEach((k) => localStorage.removeItem(k))
    return keys.length
  } catch {
    return 0
  }
}

export type PoolOptions = {
  /** Requests in flight to begin with. */
  start?: number
  min?: number
  max?: number
  /** How many times one item may be re-queued after a 429 before it is reported as failed. */
  maxRetries?: number
  onStats?: (s: PoolStats) => void
}

/**
 * Run `items` through `fn` with adaptive concurrency. The provider behind the
 * gateway throttles sustained load with 429s, so the pool halves its in-flight
 * limit on every throttle, re-queues the item with exponential backoff, and
 * creeps the limit back up after a run of successes. Results are reported as
 * they land, in any order; the returned stats say how hard the pool was pushed
 * back.
 */
export function runPool<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  onResult: (index: number, result: R | Error) => void,
  opts: PoolOptions = {},
  signal?: AbortSignal,
): Promise<PoolStats> {
  const start = opts.start ?? 4
  const min = opts.min ?? 1
  const max = opts.max ?? 8
  const maxRetries = opts.maxRetries ?? 15
  let limit = start
  let inFlight = 0
  let throttled = 0
  let retried = 0
  let streak = 0
  let remaining = items.length
  // A throttle is a shared budget, not a per-item problem: when the provider
  // pushes back, the whole pool pauses, for longer each consecutive time.
  let pauseUntil = 0
  let consecutiveThrottles = 0
  const queue = items.map((_, i) => ({ i, attempt: 0, at: 0 }))

  return new Promise((resolve) => {
    const stats = () => ({ inFlight, limit, throttled, retried })
    const report = () => opts.onStats?.(stats())
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      resolve(stats())
    }

    const pump = () => {
      if (finished) return
      if (signal?.aborted || remaining === 0) {
        if (inFlight === 0) finish()
        return
      }
      const now = Date.now()
      while (inFlight < limit && now >= pauseUntil) {
        const idx = queue.findIndex((q) => q.at <= now)
        if (idx === -1) break
        const job = queue.splice(idx, 1)[0]
        inFlight++
        report()
        fn(items[job.i], job.i)
          .then(
            (r) => {
              streak++
              consecutiveThrottles = 0
              if (streak >= 8 && limit < max) {
                limit++
                streak = 0
              }
              remaining--
              onResult(job.i, r)
            },
            (e) => {
              const status = e instanceof EvalError ? e.status : 0
              const isThrottle = status === 429
              // 502/504 here mean the gateway or provider buckled, not that the
              // request was bad; they are worth a retry but do not imply a limit.
              const retryable = isThrottle || status === 502 || status === 504
              if (retryable && job.attempt < maxRetries && !signal?.aborted) {
                retried++
                streak = 0
                let at = Date.now() + 400 + Math.random() * 400
                if (isThrottle) {
                  throttled++
                  consecutiveThrottles++
                  limit = Math.max(min, Math.floor(limit / 2))
                  const cooldown = Math.min(20000, 800 * 2 ** (consecutiveThrottles - 1)) + Math.random() * 600
                  pauseUntil = Math.max(pauseUntil, Date.now() + cooldown)
                  at = pauseUntil
                }
                queue.push({ i: job.i, attempt: job.attempt + 1, at })
              } else {
                remaining--
                onResult(job.i, e instanceof Error ? e : new Error(String(e)))
              }
            },
          )
          .finally(() => {
            inFlight--
            report()
            pump()
          })
      }
      // Everything left is waiting out a backoff or a cooldown: wake up when the first one is due.
      if (inFlight === 0 && remaining > 0 && queue.length > 0) {
        const next = Math.max(pauseUntil, Math.min(...queue.map((q) => q.at)))
        window.setTimeout(pump, Math.max(50, next - Date.now()))
      }
    }
    pump()
  })
}

/** The top two options of a choice answer, for spotting comments that carry two signals. */
export function topTwo(a: ChoiceAnswer): [string, number][] {
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2) as [string, number][]
}
