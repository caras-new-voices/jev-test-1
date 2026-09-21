import categoryJson from '../data/category.json'
import type { Brand, BrandIndex, PostsFile, ScoredPostsFile } from './types'

export const category = categoryJson as { brands: BrandIndex[]; category: string; generatedFrom: string }

// Fixed slot order: color follows the brand, never its rank in a filtered view.
export const BRAND_ORDER = category.brands.map((b) => b.id)
export const brandSlot = (id: number) => `var(--s${BRAND_ORDER.indexOf(id) + 1})`
export const shortName = (name: string) => name.replace(/\s*\((Female)\)/i, '').replace('Philips ', '')

type BrandCore = Pick<Brand, 'id' | 'slug' | 'name' | 'ai' | 'aiMeta'>
const brandModules = import.meta.glob<BrandCore>('../data/brands/*[0-9].json', { import: 'default' })
const commentModules = import.meta.glob<Brand['comments']>('../data/brands/*.comments.json', { import: 'default' })
const postModules = import.meta.glob<PostsFile>('../data/posts/*.json', { import: 'default' })
// ~1.5 MB of per-post Jev scores: only the Real EMV view pulls it, so it stays out of the main bundle.
const scoredModule = import.meta.glob<ScoredPostsFile>('../data/posts_scored.json', { import: 'default' })

export async function loadBrand(id: number): Promise<Brand> {
  const core = brandModules[`../data/brands/${id}.json`]
  const comments = commentModules[`../data/brands/${id}.comments.json`]
  if (!core || !comments) throw new Error(`No brand file for ${id}`)
  const index = category.brands.find((b) => b.id === id)
  if (!index) throw new Error(`No brand index for ${id}`)
  const [c, cm] = await Promise.all([core(), comments()])
  return { ...index, ...c, comments: cm }
}

export async function loadPosts(id: number): Promise<PostsFile | null> {
  const loader = postModules[`../data/posts/${id}.json`]
  return loader ? loader() : null
}

export const hasPosts = (id: number) => Boolean(postModules[`../data/posts/${id}.json`])

/** The offline Jev pass over every creator post. Lazy: one chunk, fetched on demand. */
export async function loadScoredPosts(): Promise<ScoredPostsFile | null> {
  const loader = scoredModule['../data/posts_scored.json']
  return loader ? loader() : null
}
