/**
 * Live comment triage through Jev (TypeSafe AI's System One model).
 *
 * Why this file exists at all: the rest of Listening Room is a static SPA, and
 * the twelve comment dimensions it shows were classified offline, in a batch,
 * by a generative LLM (see `model` in the *.comments.json files). Jev is the
 * opposite shape of model — it never writes text, it returns a typed decision
 * plus a probability — so it can run per-comment, on demand, while a client is
 * sitting in the room. This endpoint is the only server-side piece of the site.
 *
 * It is also the trust boundary. The browser sends one thing: the comment text.
 * The model id and the question set are fixed here, server-side, so the
 * endpoint cannot be used as an open relay against the account's AI Gateway
 * key. The key itself is read from the environment and never leaves this file.
 */

// The function runs on Vercel's Node runtime, where `process.env` exists. The
// project has no @types/node (it is a browser-only Vite app), so declare just
// the one global we need rather than pulling in the whole Node type surface.
declare const process: { env: Record<string, string | undefined> }

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL = 'typesafe-ai/jev'
const MAX_CHARS = 1200

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

/**
 * Four questions, all answered in a single round trip against the same state.
 * This is the part of Jev worth showing a client: `choice`, `boolean` and
 * `score` are different answer shapes, and asking for all of them costs one
 * request rather than four.
 */
const QUESTIONS = {
  dimension: {
    type: 'choice',
    instructions:
      'This is a public comment left on a social post about a female hair-removal product (razors, epilators, depilatory cream, IPL). Which single listening dimension does it belong to? Comments may be in any language.',
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
  spam: {
    type: 'boolean',
    instructions: 'Is this comment spam, a scam, a bot, or otherwise not a genuine consumer comment?',
    criteria: {
      true: 'Account-hacking offers, giveaways, crypto, follow-for-follow, link bait, or copy-pasted junk',
      false: 'A real person reacting to the product or the post',
    },
  },
}

export const config = { runtime: 'nodejs' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export default async function handler(request: Request): Promise<Response> {
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

  let text: string
  try {
    const body = (await request.json()) as { text?: unknown }
    text = typeof body?.text === 'string' ? body.text.trim() : ''
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!text) return json({ error: 'empty_text', message: 'Send { "text": "a comment" }.' }, 400)
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)

  const startedAt = Date.now()
  let upstream: Response
  try {
    upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state: text, questions: QUESTIONS }),
    })
  } catch {
    return json({ error: 'gateway_unreachable', message: 'Could not reach the AI Gateway.' }, 502)
  }
  const latencyMs = Date.now() - startedAt

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
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
    answers: data.answers ?? {},
    usage: data.usage ?? null,
    costUsd: data.providerMetadata?.gateway?.marketCost ?? null,
    latencyMs,
  })
}
