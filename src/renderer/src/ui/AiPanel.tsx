import { useEffect, useState } from 'react'
import type { AiStatus } from '@core/app/bridge'
import type { BudgetView } from '@core/budget/controller'
import { formatUsd } from '@core/budget/money'
import { bridge } from '../bridge'
import { view } from '../scene/shared'
import { useUI } from '../state/store'
import { Btn, Modal } from './primitives'

// The optional intelligence layer, in one place. Every button here says whether it uses AI.
// With AI off (the default), each gives a local reading instead, at no cost.

export function AiPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [budget, setBudget] = useState<BudgetView | null>(null)
  const [out, setOut] = useState<{ title: string; text: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const atlas = useUI((s) => s.atlas)

  const refresh = async () => {
    setStatus(await bridge.ai.status())
    setBudget(await bridge.ai.budget.view())
  }
  useEffect(() => {
    void refresh()
  }, [])

  const ask = async (title: string, feature: string, build: (summary: Record<string, number | string>) => unknown) => {
    setBusy(true)
    const summary = (await view.host?.req<Record<string, number | string>>('summary')) ?? {}
    const r = await bridge.ai.run(feature, build(summary), { userInitiated: true })
    setBusy(false)
    if (r.ok) setOut({ title, text: r.text, note: r.cached ? 'Remembered from an identical earlier question: no cost.' : `Claude's interpretation. This request cost ${formatUsd(r.cost)}.` })
    else setOut({ title, text: r.fallback, note: `Local reading (no AI used). ${r.detail}` })
    void refresh()
  }

  const on = status?.enabled
  return (
    <Modal title="Optional AI" onClose={onClose} width={620} testid="ai-panel">
      <div className="col" style={{ gap: 10 }}>
        <span className="muted" style={{ lineHeight: 1.45 }}>
          {on
            ? 'AI is on. Each button below sends one small request, only when you press it. Everything it says is interpretation; the measurements come from the simulation.'
            : status?.note ?? 'AI is off. The buttons below give local readings, which cost nothing. You can switch AI on in Settings.'}
        </span>
        {status?.mock && <span style={{ color: 'var(--amber)' }}>Test mode: replies come from a pretend Claude, for checking the game. Nothing is real or billed.</span>}
        {budget && on && (
          <div className="row" style={{ gap: 18 }}>
            <span>
              This month: <strong>{formatUsd(budget.spentMonth, 2)}</strong> of {formatUsd(budget.limits.monthly, 2)}
            </span>
            <span className="muted">Today {formatUsd(budget.spentToday, 2)} · This session {formatUsd(budget.spentSession, 2)}</span>
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Btn disabled={busy} onClick={() => void ask('What is happening here', 'interpret', (summary) => ({ summary, focus: null }))} testid="ai-interpret">
            Interpret this experiment
          </Btn>
          <Btn disabled={busy} onClick={() => void ask('Things to try', 'suggest', (summary) => ({ summary, found: atlas.map((a) => a.type) }))}>
            Suggest experiments
          </Btn>
          <Btn disabled={busy} onClick={() => void ask('A reflection', 'reflect', (summary) => ({ summary }))}>
            A reflection
          </Btn>
        </div>
        {busy && <span className="faint">Working…</span>}
        {out && (
          <div className="col panel" style={{ padding: 14, gap: 6 }} data-testid="ai-output">
            <span className="caps">{out.title}</span>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{out.text}</div>
            <span className="faint" style={{ fontSize: '0.88em' }}>
              {out.note}
            </span>
          </div>
        )}
        <div className="row">
          <div className="spacer" />
          <Btn
            kind="ghost"
            onClick={() => {
              onClose()
              useUI.getState().set({ dialog: { kind: 'settings', data: 'ai' } })
            }}
          >
            AI settings and budget
          </Btn>
          {on && (
            <Btn
              kind="danger"
              onClick={async () => {
                await bridge.ai.setEnabled(false)
                void refresh()
              }}
              testid="ai-off"
            >
              Switch AI off
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  )
}
