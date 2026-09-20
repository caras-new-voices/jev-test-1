/**
 * Live evaluation through Jev (TypeSafe AI's System One model).
 *
 * Why this file exists at all: the rest of Listening Room is a static SPA, and
 * the twelve comment dimensions it shows were classified offline, in a batch,
 * by a generative LLM (see `model` in the *.comments.json files). Jev is the
 * opposite shape of model — it never writes text, it returns a typed decision
 * plus a probability — so it can run per-comment, on demand, while a client is
 * sitting in the room. This endpoint is the only server-side piece of the site.
 *
 * It is also the trust boundary. The key is read from the environment and never
 * leaves this file, the model id is fixed here, and a request is either one of
 * the named packs below or a custom question set that has to survive validate().
 * Jev cannot emit free text — the worst a custom question set can do is spend
 * tokens on a classification — but the caps still keep the endpoint from being
 * a useful general-purpose relay.
 */

// Runs on Vercel's Edge runtime, which speaks web-standard Request/Response.
// (The Node builder treats a default export as a classic `(req, res)` handler
// and waits for `res.end()`, so returning a Response there hangs the request.)
// The project has no @types/node — it is a browser-only Vite app — so declare
// just the one global we need rather than pulling in the Node type surface.
declare const process: { env: Record<string, string | undefined> }

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL = 'typesafe-ai/jev'
const MAX_TEXT_CHARS = 1200
const MAX_STATE_CHARS = 12000
const UPSTREAM_TIMEOUT_MS = 15000

const LIMITS = {
  questions: 6,
  instructions: 400,
  choiceOptions: 12,
  scoreRungs: 10,
  criterion: 320,
  optionKey: 48,
  bank: 10,
}

type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: string; criteria: string[] }

/**
 * The same twelve dimensions the offline pipeline bucketed comments into, so a
 * live Jev answer is directly comparable to the pre-built data on the brand
 * pages. Keys match the `dimensions` keys in src/data/brands/*.comments.json.
 */
const DIMENSIONS: Record<string, string> = {
  purchase_intent: 'Wants to buy, is about to buy, or is asking where to buy',
  objections: 'A stated reason not to buy: price, performance, or a bad experience',
  faq_gaps: 'Asks a question about the product that nobody has answered',
  safety_complaints: 'Irritation, cuts, burns, rash, pain, or an allergic reaction',
  crisis_backlash: 'Accuses the brand of harm, dishonesty, or something scandalous',
  loyalty_signals: 'Long-term use, repurchase, or recommending the brand to others',
  feature_requests: 'Asks for a product, variant, or change that does not exist yet',
  competitor_mentions: 'Names a rival brand or compares this one against another',
  cross_brand_affinity: 'Mentions using this brand alongside other products in a routine',
  use_case_discovery: 'Describes using the product for an unexpected purpose or body area',
  partnership_perception: 'Reacts to the creator, the sponsorship, or the ad itself',
  engagement_quality: 'Generic reaction with no product substance: emoji, tags, filler',
}

const COMMENT_CONTEXT =
  'This is a public comment left on a social post about a female hair-removal product (razors, epilators, depilatory cream, IPL). Comments may be in any language.'

const SPAM: Question = {
  type: 'boolean',
  instructions: 'Is this comment spam, a scam, a bot, or otherwise not a genuine consumer comment?',
  criteria: {
    true: 'Account-hacking offers, giveaways, crypto, follow-for-follow, link bait, or copy-pasted junk',
    false: 'A real person reacting to the product or the post',
  },
}

/**
 * The jobs the agency actually has to do with this corpus, each expressed as a
 * set of typed questions. They exist to show that Jev is not "a classifier" —
 * the same model answers routing, screening and data-quality questions, in
 * whatever shape the job needs, in one round trip.
 */
const PACKS: Record<string, { label: string; questions: Record<string, Question> }> = {
  triage: {
    label: 'Comment triage',
    questions: {
      dimension: {
        type: 'choice',
        instructions: `${COMMENT_CONTEXT} Which single listening dimension does it belong to?`,
        criteria: DIMENSIONS,
      },
      worthACall: {
        type: 'boolean',
        instructions:
          'Should a researcher invite this person to a short outbound voice interview to learn why they feel this way?',
        criteria: {
          true: 'Has a specific, personal, first-hand experience or objection that a two-minute call could usefully explain',
          false: 'Generic praise, an emoji, spam, or a factual question that support can simply answer',
        },
      },
      urgency: {
        type: 'score',
        instructions: 'How urgently does the brand need to respond to this comment?',
        criteria: [
          'No response needed',
          'Worth a routine reply',
          'Should be answered promptly',
          'Escalate now: safety, legal, or reputational risk',
        ],
      },
      spam: SPAM,
    },
  },

  /** Twelve booleans at once: a comment can live in several dimensions, and a single label hides that. */
  profile: {
    label: 'Full 12-dimension profile',
    questions: Object.fromEntries(
      Object.entries(DIMENSIONS).map(([key, desc]) => [
        key,
        {
          type: 'boolean',
          instructions: `${COMMENT_CONTEXT} Does this comment contain this signal: ${desc.toLowerCase()}?`,
        } satisfies Question,
      ]),
    ),
  },

  route: {
    label: 'Route and act',
    questions: {
      owner: {
        type: 'choice',
        instructions: `${COMMENT_CONTEXT} Which team inside the brand should own the response?`,
        criteria: {
          community: 'Community management — a reply, a thank you, or an answer',
          product: 'Product and R&D — a defect, a design flaw, or a feature gap',
          safety_legal: 'Safety, regulatory or legal — injury, health claims, or accusations',
          ecommerce: 'E-commerce and retail — stock, pricing, discount codes, delivery',
          media: 'Media and creator team — the sponsorship, the creator, or the ad itself',
          none: 'Nobody needs to act on this',
        },
      },
      publicReply: {
        type: 'boolean',
        instructions: 'Should the brand reply to this comment publicly, in the thread?',
        criteria: {
          true: 'A public answer would help this person and everyone else reading',
          false: 'Better handled privately, or better left alone entirely',
        },
      },
      tone: {
        type: 'choice',
        instructions: 'If the brand does respond, what should the response do first?',
        criteria: {
          apologise: 'Acknowledge a bad experience before anything else',
          answer: 'Give a plain factual answer to a question',
          thank: 'Thank them for positive feedback',
          take_private: 'Move the conversation to DM or support',
          do_not_engage: 'Do not engage — spam, trolling, or bait',
        },
      },
      priority: {
        type: 'score',
        instructions: 'How high should this sit in the community team’s queue this morning?',
        criteria: ['Bottom of the queue', 'Normal', 'Ahead of the queue', 'Drop everything'],
      },
    },
  },

  screen: {
    label: 'Voice-survey screener',
    questions: {
      goodCandidate: {
        type: 'boolean',
        instructions:
          'Would this person make a useful respondent for a two-minute outbound voice interview about their hair-removal choices?',
        criteria: {
          true: 'Has first-hand experience and a reason for it that they could explain out loud',
          false: 'No personal experience, or nothing to explain beyond the comment itself',
        },
      },
      openingQuestion: {
        type: 'choice',
        instructions:
          'The interview opens with one question chosen from the brand’s script. Based on this comment, which opener earns the most?',
        criteria: {
          switching: 'What made you move away from what you used before?',
          price: 'What would you expect to pay, and what makes it feel worth it?',
          irritation: 'Tell me about the last time your skin reacted badly.',
          routine: 'Walk me through your routine, start to finish.',
          repurchase: 'What would make you buy this again — or stop?',
          discovery: 'How did you first hear about this product?',
        },
      },
      buyerLikelihood: {
        type: 'score',
        instructions: 'How likely is it that this person has actually bought and used the product?',
        criteria: ['Clearly has not', 'Probably not', 'Probably has', 'Clearly has'],
      },
      candour: {
        type: 'score',
        instructions: 'How candid and specific is this person being?',
        criteria: ['Generic noise', 'Vague opinion', 'Specific and personal', 'Unusually detailed'],
      },
    },
  },

  quality: {
    label: 'Language and data quality',
    questions: {
      language: {
        type: 'choice',
        instructions: 'What language is this comment written in?',
        criteria: {
          en: 'English',
          de: 'German',
          fr: 'French',
          it: 'Italian',
          es: 'Spanish',
          nl: 'Dutch',
          pl: 'Polish',
          uk: 'Ukrainian',
          ru: 'Russian',
          ar: 'Arabic',
          other: 'Some other language',
        },
      },
      isEnglish: { type: 'boolean', instructions: 'Is this comment written in English?' },
      onTopic: {
        type: 'boolean',
        instructions: 'Is this comment actually about hair removal or a hair-removal product?',
        criteria: {
          true: 'Discusses the product, the results, the skin, the price, or the routine',
          false: 'Off-topic chatter, tagging a friend, or about something else entirely',
        },
      },
      spam: SPAM,
    },
  },

  /** Runs on a whole interview transcript once the call has ended. */
  debrief: {
    label: 'Interview debrief',
    questions: {
      status: {
        type: 'choice',
        instructions:
          'This is the transcript of a short voice interview about a hair-removal brand. What is the respondent’s relationship with the brand?',
        criteria: {
          current: 'Uses it now',
          lapsed: 'Used it before and stopped',
          considering: 'Has not bought yet but is thinking about it',
          never: 'Has never used it and is not planning to',
          unclear: 'The transcript does not say',
        },
      },
      driver: {
        type: 'choice',
        instructions: 'What matters most to this respondent when choosing a hair-removal product?',
        criteria: {
          price: 'Price and value',
          skin: 'Skin comfort and irritation',
          performance: 'Closeness and lasting results',
          convenience: 'Speed, ease and availability',
          image: 'Brand image and design',
          other: 'Something else or unclear',
        },
      },
      churnRisk: {
        type: 'score',
        instructions: 'How likely is this respondent to leave the brand, or never adopt it?',
        criteria: ['Loyal', 'Stable', 'Wavering', 'Gone or never coming'],
      },
      wouldRecommend: {
        type: 'score',
        instructions: 'How likely is this respondent to recommend the brand to a friend?',
        criteria: ['Would warn people off', 'Would not mention it', 'Would recommend if asked', 'Actively recommends'],
      },
      quoteworthy: {
        type: 'boolean',
        instructions: 'Did the respondent say anything vivid and specific enough to quote on a slide to the brand?',
      },
      interviewQuality: {
        type: 'score',
        instructions: 'How much did this interview actually teach us about why the respondent behaves the way they do?',
        criteria: ['Nothing new', 'A little', 'Something useful', 'A genuine insight'],
      },
    },
  },
}

/**
 * Fixed follow-up probes for the adaptive interview. Jev decides *when* to use
 * one; it never writes one. Every line the interviewer can say was written by a
 * person, which is the whole reason this can sit between two voice turns.
 */
const PROBES: Record<string, string> = {
  probe_more: 'Follow up: “Tell me more about that.”',
  probe_why: 'Follow up: “Why do you think that is?”',
  probe_then: 'Follow up: “And what did you do next?”',
}

export const config = { runtime: 'edge' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

/**
 * Validate a caller-supplied question set. Returns the cleaned set, or an error
 * string. Deliberately strict: unknown keys are dropped by reconstruction rather
 * than passed through.
 */
function validate(raw: unknown): { questions: Record<string, Question> } | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'questions must be an object' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0) return { error: 'send at least one question' }
  if (entries.length > LIMITS.questions) return { error: `at most ${LIMITS.questions} questions per request` }

  const out: Record<string, Question> = {}
  for (const [name, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) return { error: `bad question name: ${name.slice(0, 40)}` }
    if (typeof value !== 'object' || value === null) return { error: `${name}: must be an object` }
    const q = value as Record<string, unknown>
    if (!str(q.instructions, LIMITS.instructions)) {
      return { error: `${name}: instructions must be 1–${LIMITS.instructions} characters` }
    }
    const instructions = (q.instructions as string).trim()

    if (q.type === 'boolean') {
      const c = q.criteria as Record<string, unknown> | undefined
      if (c === undefined) {
        out[name] = { type: 'boolean', instructions }
      } else {
        if (!str(c.true, LIMITS.criterion) || !str(c.false, LIMITS.criterion)) {
          return { error: `${name}: boolean criteria need "true" and "false" descriptions` }
        }
        out[name] = { type: 'boolean', instructions, criteria: { true: c.true as string, false: c.false as string } }
      }
      continue
    }

    if (q.type === 'choice') {
      const c = q.criteria
      if (typeof c !== 'object' || c === null || Array.isArray(c)) return { error: `${name}: choice needs a criteria object` }
      const opts = Object.entries(c as Record<string, unknown>)
      if (opts.length < 2 || opts.length > LIMITS.choiceOptions) {
        return { error: `${name}: choice needs 2–${LIMITS.choiceOptions} options` }
      }
      const criteria: Record<string, string> = {}
      for (const [k, v] of opts) {
        if (k.length > LIMITS.optionKey || !str(v, LIMITS.criterion)) return { error: `${name}: bad option "${k.slice(0, 40)}"` }
        criteria[k] = (v as string).trim()
      }
      out[name] = { type: 'choice', instructions, criteria }
      continue
    }

    if (q.type === 'score') {
      const c = q.criteria
      if (!Array.isArray(c) || c.length < 2 || c.length > LIMITS.scoreRungs) {
        return { error: `${name}: score needs 2–${LIMITS.scoreRungs} ordered labels` }
      }
      if (!c.every((r) => str(r, LIMITS.criterion))) return { error: `${name}: score labels must be short strings` }
      out[name] = { type: 'score', instructions, criteria: c.map((r) => (r as string).trim()) }
      continue
    }

    return { error: `${name}: type must be choice, boolean or score` }
  }
  return { questions: out }
}

/**
 * Build the adaptive-interview question set. The caller sends the scripted
 * questions that have not been asked yet (id + text, from the brand's script);
 * the server adds the fixed probes and the option to end, and asks three side
 * questions about the last exchange.
 */
function interviewQuestions(bankRaw: unknown, allowProbes: boolean): Record<string, Question> | { error: string } {
  if (!Array.isArray(bankRaw) || bankRaw.length > LIMITS.bank) return { error: `bank must be an array of at most ${LIMITS.bank} items` }
  const criteria: Record<string, string> = {}
  for (const item of bankRaw as unknown[]) {
    const it = item as { id?: unknown; text?: unknown }
    if (!str(it?.id, LIMITS.optionKey) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(it.id as string)) return { error: 'bank items need an id' }
    if (!str(it?.text, LIMITS.criterion)) return { error: `bank item ${String(it.id).slice(0, 20)}: text too long or missing` }
    criteria[it.id as string] = `Ask: “${(it.text as string).trim()}”`
  }
  if (allowProbes) Object.assign(criteria, PROBES)
  criteria.end = 'End the call now: we have learned what we can, or the respondent is disengaging'
  if (Object.keys(criteria).length < 2) return { error: 'bank is empty' }

  return {
    next: {
      type: 'choice',
      instructions:
        'This is a live two-minute voice interview about a hair-removal brand. `transcript` is everything said so far, most recent last. Given what the respondent just said, what should the interviewer do next? Prefer a follow-up probe only when the last answer opened something worth one more sentence. Prefer a scripted question that the last answer makes natural. End when the questions are exhausted or the respondent is clearly done.',
      criteria,
    },
    answered: {
      type: 'boolean',
      instructions: 'Did the respondent’s most recent reply actually answer the interviewer’s most recent question?',
    },
    engagement: {
      type: 'score',
      instructions: 'How engaged is the respondent right now, judging by their most recent replies?',
      criteria: ['Disengaging — short, evasive, wants to go', 'Polite but flat', 'Engaged and specific', 'Eager, volunteering detail'],
    },
    dimension: {
      type: 'choice',
      instructions: 'Which listening dimension does the respondent’s most recent reply speak to?',
      criteria: DIMENSIONS,
    },
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    // Lets the UI (and a curious reader) see exactly what the server will ask.
    return json({
      model: MODEL,
      limits: LIMITS,
      packs: Object.fromEntries(Object.entries(PACKS).map(([k, v]) => [k, { label: v.label, questions: v.questions }])),
      probes: PROBES,
    })
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) {
    // Surfaced verbatim in the UI so a misconfigured deployment explains itself
    // instead of looking like the model failed.
    return json(
      {
        error: 'not_configured',
        message:
          'AI_GATEWAY_API_KEY is not set on this deployment. Add it in Vercel → Project → Settings → Environment Variables and redeploy.',
      },
      503,
    )
  }

  let body: { text?: unknown; state?: unknown; pack?: unknown; questions?: unknown; bank?: unknown; allowProbes?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  // State is either a plain comment (`text`) or a structured object (`state`),
  // e.g. an interview transcript. Both are capped.
  let state: unknown
  if (typeof body.text === 'string' && body.text.trim()) {
    state = body.text.trim().slice(0, MAX_TEXT_CHARS)
  } else if (body.state !== undefined && body.state !== null) {
    const serialised = JSON.stringify(body.state)
    if (serialised.length > MAX_STATE_CHARS) return json({ error: 'state_too_large', message: `state must serialise to ≤ ${MAX_STATE_CHARS} characters` }, 400)
    state = body.state
  } else {
    return json({ error: 'empty_state', message: 'Send { "text": "a comment" } or { "state": {...} }.' }, 400)
  }

  let questions: Record<string, Question>
  let packName: string | null = null
  if (body.questions !== undefined) {
    const checked = validate(body.questions)
    if ('error' in checked) return json({ error: 'invalid_questions', message: checked.error }, 400)
    questions = checked.questions
  } else if (body.pack === 'interview') {
    const built = interviewQuestions(body.bank, body.allowProbes !== false)
    if ('error' in built) return json({ error: 'invalid_bank', message: built.error }, 400)
    questions = built
    packName = 'interview'
  } else {
    packName = typeof body.pack === 'string' && body.pack in PACKS ? body.pack : 'triage'
    questions = PACKS[packName].questions
  }

  // Under provider load the gateway can hold a request for 25 s+, which trips
  // the Edge runtime's own timeout and returns an HTML error page. Give up
  // earlier with a JSON 504 the client knows how to retry.
  const startedAt = Date.now()
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: timeout.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (timeout.signal.aborted) {
      return json({ error: 'gateway_timeout', message: `The provider did not answer within ${UPSTREAM_TIMEOUT_MS / 1000} s. Retrying.` }, 504)
    }
    return json({ error: 'gateway_unreachable', message: 'Could not reach the AI Gateway.' }, 502)
  }
  clearTimeout(timer)
  const latencyMs = Date.now() - startedAt

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    // Pass a provider throttle through as a real 429 so the client can back off
    // and retry instead of treating it as a failure.
    if (upstream.status === 429) {
      return json({ error: 'rate_limited', message: 'The provider is throttling this key. Backing off and retrying.', detail: detail.slice(0, 300) }, 429)
    }
    return json({ error: 'gateway_error', status: upstream.status, detail: detail.slice(0, 400) }, 502)
  }

  const data = (await upstream.json()) as {
    model?: string
    answers?: unknown
    usage?: unknown
    providerMetadata?: { gateway?: { marketCost?: string } }
  }

  return json({
    model: data.model ?? MODEL,
    pack: packName,
    questions,
    answers: data.answers ?? {},
    usage: data.usage ?? null,
    costUsd: data.providerMetadata?.gateway?.marketCost ?? null,
    latencyMs,
  })
}
