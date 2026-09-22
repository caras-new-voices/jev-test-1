import type { ReactNode } from 'react'
import { brandSlot, shortName } from '../lib/data'
import { compact } from '../lib/format'
import { englishFor, useLangMode, useTranslations } from '../lib/translate'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-surface p-4 sm:p-5 ${className}`}>{children}</section>
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Swatch({ id, size = 10 }: { id: number; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: brandSlot(id) }} />
}

export function BrandChip({ id, name, active, onClick }: { id: number; name: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${active ? 'border-ink bg-ink text-page' : 'border-border bg-surface text-ink hover:bg-surface-2'}`}
    >
      <Swatch id={id} />
      {shortName(name)}
    </button>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    good: 'bg-surface-2 text-good-text',
    warn: 'bg-surface-2 text-ink',
    bad: 'bg-surface-2 text-critical',
    accent: 'bg-accent-soft text-ink',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Renders one piece of source text in the reader's chosen language. When an
 * English translation exists and English is selected, the translation is shown
 * and the verbatim original is kept directly beneath it — the evidence is never
 * replaced, only accompanied.
 */
export function Translated({ text, className = '', originalClassName = '' }: { text: string; className?: string; originalClassName?: string }) {
  useTranslations()
  const mode = useLangMode()
  const en = englishFor(text)
  if (!en || mode === 'original') return <span className={className}>{text}</span>
  return (
    <>
      <span className={className}>{en}</span>
      <span className={`mt-1 block text-xs italic text-muted ${originalClassName}`} lang="und" dir="auto">
        {text}
      </span>
    </>
  )
}

export function Quote({ text, meta }: { text: string; meta?: string }) {
  useTranslations()
  const mode = useLangMode()
  const en = englishFor(text)
  const showBoth = Boolean(en) && mode === 'en'
  return (
    <blockquote className="rounded-lg border-l-2 border-axis bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink">
      <span className="text-muted">“</span>
      {showBoth ? en : text}
      <span className="text-muted">”</span>
      {showBoth && (
        <div className="mt-1.5 border-t border-border pt-1.5 text-xs italic leading-relaxed text-muted" dir="auto">
          {text}
        </div>
      )}
      {meta && <div className="mt-1 text-xs text-muted">{meta}</div>}
    </blockquote>
  )
}

export function Num({ n }: { n: number }) {
  return <span className="tabular">{compact(n)}</span>
}

export function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }[]; label?: string; format?: (v: number, name?: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      {label && <div className="mb-1 font-medium text-ink">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-ink-2">
          {p.color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />}
          <span>{p.name}</span>
          <span className="ml-auto tabular text-ink">{format ? format(p.value ?? 0, p.name) : compact(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  )
}

/** Render the insight HTML (h3/ul/li/strong/em/p only) produced by the analysis pipeline. */
export function InsightHtml({ html }: { html: string }) {
  const safe = html
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?!\/?(h3|ul|ol|li|strong|em|p|br)\b)[^>]*>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
  return <div className="prose-insight" dangerouslySetInnerHTML={{ __html: safe }} />
}
