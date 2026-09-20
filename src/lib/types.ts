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
