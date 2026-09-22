import { useEffect, useState } from 'react'

/**
 * English translations for the non-English text in this report.
 *
 * Jev cannot do this job: it returns typed decisions, never text. So the
 * translations were produced separately and are shipped as data, keyed by the
 * verbatim original string. Nothing in src/data is rewritten — the originals
 * stay exactly as they came out of the export, and every place that shows a
 * translation also shows the original underneath.
 *
 * The file is a few hundred KB, so it is loaded lazily on first use rather than
 * bundled into the entry chunk. Components subscribe with useTranslations().
 */

type Bundle = { generatedAt: string; note: string; count: number; t: Record<string, string> }

const load = import.meta.glob<Bundle>('../data/translations.json', { import: 'default' })[
  '../data/translations.json'
]

let table: Record<string, string> = {}
let meta: { generatedAt: string; count: number } | null = null
let started = false
const listeners = new Set<() => void>()

function begin() {
  if (started || !load) return
  started = true
  load()
    .then((b) => {
      table = b.t
      meta = { generatedAt: b.generatedAt, count: b.count }
      listeners.forEach((fn) => fn())
    })
    .catch(() => {
      /* the page still works untranslated */
    })
}

/** Re-renders the caller once the table has loaded. Returns how many entries there are. */
export function useTranslations(): number {
  const [n, setN] = useState(meta?.count ?? 0)
  useEffect(() => {
    begin()
    const fn = () => setN(meta?.count ?? 0)
    listeners.add(fn)
    fn()
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return n
}

/** The English rendering of `text`, or null when it is already English (or unknown). */
export function englishFor(text: string | undefined | null): string | null {
  if (!text) return null
  return table[text] ?? table[text.trim()] ?? null
}

export const translationsGeneratedAt = () => meta?.generatedAt ?? null

/* ---------------------------------------------------------------- preference */

export type LangMode = 'en' | 'original'
const KEY = 'lang-mode'
let mode: LangMode = (() => {
  try {
    return localStorage.getItem(KEY) === 'original' ? 'original' : 'en'
  } catch {
    return 'en'
  }
})()
const modeListeners = new Set<() => void>()

export function setLangMode(next: LangMode) {
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* private window: the choice just does not persist */
  }
  modeListeners.forEach((fn) => fn())
}

/** The current reading mode. 'en' shows the translation with the original beneath. */
export function useLangMode(): LangMode {
  const [m, setM] = useState(mode)
  useEffect(() => {
    const fn = () => setM(mode)
    modeListeners.add(fn)
    fn()
    return () => {
      modeListeners.delete(fn)
    }
  }, [])
  return m
}

/**
 * What to render for one piece of source text: the English if we have it and
 * the reader wants it, plus the original to show alongside.
 */
export function readable(text: string): { primary: string; original: string | null } {
  const en = englishFor(text)
  if (!en || mode === 'original') return { primary: text, original: null }
  return { primary: en, original: text }
}
