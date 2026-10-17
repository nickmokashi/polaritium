import { useEffect, useState } from 'react'
import type { Reading } from '@core/sim/inspect'
import { bridge } from '../bridge'
import { useUI } from '../state/store'
import { focusOn } from '../scene/camera'
import { adjustSelected, entityWorld, selectEntity } from '../scene/Interaction'
import { view } from '../scene/shared'
import { Bar, Btn } from './primitives'

// The inspector: what the selected thing is doing, in words first, then its numbers. It
// refreshes a few times a second from the simulation.

export function Inspector() {
  const reading = useUI((s) => s.reading)
  const selection = useUI((s) => s.selection)
  const tool = useUI((s) => s.tool)
  const [more, setMore] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ai, setAi] = useState<{ text: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAi(null)
    if (!selection.length) return
    const id = selection[selection.length - 1]
    const t = setInterval(async () => {
      const r = await view.host?.req<Reading | null>('inspect', { id })
      if (!r) {
        await selectEntity(null)
        return
      }
      useUI.getState().set({ reading: r })
    }, 350)
    return () => clearInterval(t)
  }, [selection])

  if (!reading) return null
  const r = reading

  const ask = async () => {
    setBusy(true)
    const feature = r.type === 'organism' ? 'organism' : 'interpret'
    const summary = await view.host?.req<Record<string, number | string>>('summary')
    const input = feature === 'organism' ? { title: r.title, facts: r.facts } : { summary: summary ?? {}, focus: { title: r.title, facts: r.facts } }
    const out = await bridge.ai.run(feature, input, { userInitiated: true })
    setBusy(false)
    if (out.ok) setAi({ text: out.text, note: out.cached ? 'Remembered from an earlier identical question (no cost).' : `Claude's reading (interpretation). Cost ${(out.cost / 1e6).toFixed(4)} USD.` })
    else setAi({ text: out.fallback, note: `Local reading. ${out.detail}` })
  }

  return (
    <div className="panel fade-in scroll" data-testid="inspector" style={{ position: 'absolute', right: 14, top: 64, width: 300, maxHeight: 'calc(100% - 170px)', padding: 14, zIndex: 20 }}>
      <div className="row">
        <div className="col" style={{ gap: 0 }}>
          <span className="caps">{r.title}</span>
          <span className="display" style={{ fontSize: '1.45em' }}>
            {r.name ?? `#${r.id}`}
          </span>
        </div>
        <div className="spacer" />
        <Btn
          small
          kind="ghost"
          title="Move the camera to it"
          onClick={() => {
            const p = entityWorld(r.id)
            if (p) focusOn(p, 2)
          }}
        >
          Focus
        </Btn>
        <Btn small kind="ghost" title="Stop inspecting" onClick={() => void selectEntity(null)}>
          ✕
        </Btn>
      </div>
      <div className="col" style={{ gap: 6, margin: '8px 0 10px', lineHeight: 1.45 }}>
        {r.doing.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      {r.bars.length > 0 && (
        <div className="col" style={{ gap: 6, marginBottom: 10 }}>
          {r.bars.map(([label, v]) => (
            <Bar key={label} label={label} value={v} />
          ))}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {(more ? [...r.values, ...r.more] : r.values).map(([k, v]) => (
            <tr key={k}>
              <td className="muted" style={{ padding: '2px 0' }}>
                {k}
              </td>
              <td style={{ textAlign: 'right' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
        {r.more.length > 0 && (
          <Btn small kind="ghost" onClick={() => setMore(!more)} title="Show or hide the detailed numbers">
            {more ? 'Less' : 'More detail'}
          </Btn>
        )}
        {(r.type === 'node' || r.type === 'strand' || r.type === 'crystal') && (
          <>
            <Btn small title={tool === 'twist' ? 'Twist it less' : tool === 'pull' ? 'Shorten it' : r.type === 'strand' ? 'Lower the coupling' : 'Slow its rhythm'} onClick={() => void adjustSelected(r.id, -1)}>
              −
            </Btn>
            <Btn small title={tool === 'twist' ? 'Twist it more' : tool === 'pull' ? 'Lengthen it' : r.type === 'strand' ? 'Raise the coupling' : 'Quicken its rhythm'} onClick={() => void adjustSelected(r.id, 1)}>
              +
            </Btn>
          </>
        )}
        {r.type !== 'field' && (
          <Btn small kind="ghost" title="Give it a name of your own" onClick={() => setRenaming(r.name ?? '')}>
            Name it
          </Btn>
        )}
        <Btn small kind="ghost" title="Ask for an interpretation (uses AI if it is switched on; otherwise a local reading)" onClick={() => void ask()} disabled={busy}>
          {busy ? 'Thinking…' : 'Interpret'}
        </Btn>
      </div>
      {renaming !== null && (
        <div className="row" style={{ marginTop: 8 }}>
          <input type="text" value={renaming} maxLength={60} autoFocus onChange={(e) => setRenaming(e.target.value)} style={{ flex: 1 }} placeholder="A name" />
          <Btn
            small
            onClick={async () => {
              await view.host?.cmd({ type: 'rename', id: r.id, name: renaming }, true)
              setRenaming(null)
            }}
          >
            Save
          </Btn>
          <NameSuggest r={r} onPick={(n) => setRenaming(n)} />
        </div>
      )}
      {ai && (
        <div className="col" style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }} data-testid="interpretation">
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{ai.text}</div>
          <div className="faint" style={{ fontSize: '0.86em' }}>
            {ai.note}
          </div>
        </div>
      )}
      {r.links.length > 0 && (
        <div className="col" style={{ marginTop: 10, gap: 4 }}>
          <span className="caps">Connected</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {r.links.slice(0, 10).map((l) => (
              <Btn key={`${l.id}-${l.label}`} small kind="ghost" onClick={() => void selectEntity(l.id)} title="Inspect this instead">
                {l.label}
              </Btn>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NameSuggest({ r, onPick }: { r: Reading; onPick: (n: string) => void }) {
  const [names, setNames] = useState<string[] | null>(null)
  return (
    <>
      <Btn
        small
        kind="ghost"
        title="Suggest names (Claude if AI is on, otherwise local suggestions)"
        onClick={async () => {
          const out = await bridge.ai.run('name', { kind: r.type === 'organism' ? 'organism' : r.type === 'ring' ? 'structure' : 'pattern', facts: r.facts }, { userInitiated: true })
          const text = out.ok ? out.text : out.fallback
          setNames(text.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3))
        }}
      >
        Suggest
      </Btn>
      {names && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 4, width: '100%' }}>
          {names.map((n) => (
            <Btn key={n} small onClick={() => onPick(n)}>
              {n}
            </Btn>
          ))}
        </div>
      )}
    </>
  )
}
