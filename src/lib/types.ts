export type Platform = 'tiktok' | 'instagram' | 'youtube'

export interface Metrics {
  posts: number
  byPlatform: Record<Platform, number>
  influencers: number
  paidInfluencers: number
  emv: number
  engagement: number
  impressions: number
  followers: number
  budgetMin: number
  budgetMax: number
  sentiment: Record<'positive' | 'neutral' | 'negative', { count: number; pct: number }>
  tiers: Record<'nano' | 'micro' | 'midTier' | 'macro' | 'mega', number>
  firstPost: string
  lastPost: string
}

export interface BrandIndex {
  id: number
  slug: string
  name: string
  headline: string
  framing: string
  metrics: Metrics
  weekly: { label: string; avgBudget: number; followers: number; influencers: number }[]
  languages: { language: string; count: number; emv: number }[]
  dimensionTotals: Record<string, number>
  scanStart: string
  analyzedAt: string
}

export interface Quote { text: string }

export interface Dimension {
  count: number
  summary: string
  top_quotes: Quote[]
  items: Record<string, unknown>[]
}

export interface Finding {
  title: string
  business_implication: string
  recommended_action_area: string
  supporting_dimensions: string[]
}

export interface PlatformComments {
  sampleSize?: number
  model?: string
  generatedAt?: string
  synthesis: { summary: string; findings: Finding[] } | null
  dimensions: Record<string, Dimension | null>
}

export interface AiBlock { headline: string; framing: string; assess: string; anticipate: string; act: string }

export interface Brand extends BrandIndex {
  ai: Record<'all' | Platform, AiBlock>
  aiMeta: { sampleSize?: number; itemsAnalyzed?: number; generatedAt?: string; analysisType?: string }
  comments: Partial<Record<Platform, PlatformComments>>
}

export interface Post {
  id: string
  username: string
  platform: Platform
  type: string
  url: string
  text: string
  publishedAt: string
  likes: number
  comments: number
  shares: number
  views: number
  emv: number
  tier: string | null
  country: string | null
  followers: number
  sentiment: string
  paid: boolean
}

export interface PostsFile { segment: number; total: number; posts: Post[] }

/* ---------------------------------------------- offline Jev pass (Real EMV) */

/** One question as it was put to Jev, echoed into the data file so the view can show it. */
export type ScoredQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: string; criteria: string[] }

/** One creator post with the six answers. Probabilities and scores are rounded to 2 dp. */
export interface ScoredPost {
  id: string
  brandId: number
  platform: Platform
  date: string
  username: string
  url: string
  country: string | null
  tier: string | null
  followers: number
  emv: number
  /** Brandwatch's own is_paid flag. */
  paidFlag: boolean
  /** Brandwatch's own language field: "unknown" on 64% of rows. */
  bwLanguage: string
  snippet: string
  /** Probability the post is substantively about the brand's product. */
  about: number
  /** How central the product is, 0–3. */
  prom: number
  /** Probability the caption discloses a paid or gifted partnership. */
  disclosed: number
  format: string
  formatP: number
  claim: string
  lang: string
  langP: number
}

export interface ScoredPostsFile {
  generatedAt: string
  model: string
  coverage: { posts: number; scored: number; failed: number }
  spend: { costUsd: number; modelMs: number; wallSeconds: number }
  questions: Record<string, ScoredQuestion>
  posts: ScoredPost[]
}
