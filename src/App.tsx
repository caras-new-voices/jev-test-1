import { useEffect, useState } from 'react'
import AskNext from './components/AskNext'
import BrandView from './components/BrandView'
import Compare from './components/Compare'
import LiveTriage from './components/LiveTriage'
import Overview from './components/Overview'
import { BrandChip } from './components/ui'
import { category } from './lib/data'

type Route = { view: 'overview' } | { view: 'brand'; id: number } | { view: 'compare' } | { view: 'ask' } | { view: 'live' }

function parse(hash: string): Route {
  const m = hash.match(/^#\/brand\/(\d+)/)
  if (m) return { view: 'brand', id: Number(m[1]) }
  if (hash.startsWith('#/compare')) return { view: 'compare' }
  if (hash.startsWith('#/ask')) return { view: 'ask' }
  if (hash.startsWith('#/live')) return { view: 'live' }
  return { view: 'overview' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => {
    try { return (localStorage.getItem('theme') as 'light' | 'dark') || 'auto' } catch { return 'auto' }
  })

  useEffect(() => {
    const onHash = () => { setRoute(parse(window.location.hash)); window.scrollTo({ top: 0 }) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
    try { if (theme === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  const go = (hash: string) => { window.location.hash = hash }
  const openBrand = (id: number) => go(`#/brand/${id}`)
  const nav: { key: Route['view']; label: string; hash: string }[] = [
    { key: 'overview', label: 'Category', hash: '#/' },
    { key: 'compare', label: 'Compare', hash: '#/compare' },
    { key: 'ask', label: 'Ask them next', hash: '#/ask' },
    { key: 'live', label: 'Live with Jev', hash: '#/live' },
  ]

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-page/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <button type="button" onClick={() => go('#/')} className="text-left">
            <div className="text-sm font-semibold text-ink">Listening Room</div>
            <div className="text-xs text-muted">{category.category} · six brands · creator posts and audience comments</div>
          </button>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <button key={n.key} type="button" onClick={() => go(n.hash)} className={`rounded-md px-3 py-1.5 text-sm ${route.view === n.key ? 'bg-ink text-page' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>{n.label}</button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {(['auto', 'light', 'dark'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTheme(t)} aria-pressed={theme === t} className={`rounded px-2 py-1 ${theme === t ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3">
          {category.brands.map((b) => (
            <BrandChip key={b.id} id={b.id} name={b.name} active={route.view === 'brand' && route.id === b.id} onClick={() => openBrand(b.id)} />
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {route.view === 'overview' && <Overview onOpen={openBrand} />}
        {route.view === 'brand' && (category.brands.some((b) => b.id === route.id) ? <BrandView id={route.id} /> : <Overview onOpen={openBrand} />)}
        {route.view === 'compare' && <Compare onOpen={openBrand} />}
        {route.view === 'ask' && <AskNext />}
        {route.view === 'live' && <LiveTriage />}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted">
        Source: Brandwatch query segments and creator post exports (Oct 2025 – Aug 2026), enriched with per-platform comment classification. Post-level sample shown for Estrid only. Demo build.
      </footer>
    </div>
  )
}
