import CorpusSweep from './CorpusSweep'
import Interview from './Interview'
import LiveTriage from './LiveTriage'

/**
 * The three live Jev demonstrations, in the order a client should see them:
 * one comment, then the whole corpus, then a live conversation.
 */
export type LabTab = 'try' | 'audit' | 'call'

const TABS: { key: LabTab; label: string; hash: string; sub: string }[] = [
  { key: 'try', label: 'One comment', hash: '#/live', sub: 'What Jev is, four question packs, and your own question' },
  { key: 'audit', label: 'The whole report', hash: '#/live/audit', sub: 'Re-classify every quote live and audit the offline pass' },
  { key: 'call', label: 'A live call', hash: '#/live/call', sub: 'Jev chooses the next scripted question between voice turns' },
]

export default function JevLab({ tab }: { tab: LabTab }) {
  return (
    <div className="space-y-5">
      <nav aria-label="Jev demonstrations" className="grid gap-2 sm:grid-cols-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              window.location.hash = t.hash
            }}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`rounded-lg border px-4 py-3 text-left transition ${tab === t.key ? 'border-ink bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}
          >
            <div className="text-sm font-medium text-ink">{t.label}</div>
            <div className="mt-0.5 text-xs text-ink-2">{t.sub}</div>
          </button>
        ))}
      </nav>
      {tab === 'try' && <LiveTriage />}
      {tab === 'audit' && <CorpusSweep />}
      {tab === 'call' && <Interview />}
    </div>
  )
}
