import React, { useEffect, useState } from 'react'
import { CHAMBER_BY_ID } from '@core/sim/chambers'
import { LAW_TEXT } from '@core/sim/discovery'
import { envOf } from '@core/sim/environments'
import { ARCHETYPES } from '@core/sim/organisms'
import type { Laws } from '@core/sim/types'
import { useUI, type SeedKind } from '../state/store'
import { allowedTools, ix, undoRedo } from '../scene/Interaction'
import { view } from '../scene/shared'
import { Bar, Btn, Icon, formatTime } from './primitives'
import { TOOLS, TOOL_BY_ID } from './tools'

export function ToolRail() {
  const tool = useUI((s) => s.tool)
  const lens = useUI((s) => s.lens)
  const spec = useUI((s) => s.spec)
  const allowed = allowedTools()
  const [hover, setHover] = useState<string | null>(null)
  void spec
  return (
    <div className="panel" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', padding: 6, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 20 }} data-testid="tool-rail">
      {TOOLS.filter((t) => !allowed || allowed.includes(t.id) || t.id === 'lens').map((t) => {
        const active = t.id === 'lens' ? lens : tool === t.id
        return (
          <div key={t.id} style={{ position: 'relative' }} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}>
            <button
              className="tool btn ghost"
              data-testid={`tool-${t.id}`}
              aria-label={t.name}
              style={{ width: 40, height: 40, padding: 0, borderColor: active ? 'rgba(255,255,255,0.6)' : 'transparent', background: active ? 'rgba(255,255,255,0.12)' : 'transparent' }}
              onClick={() => {
                const ui = useUI.getState()
                if (t.id === 'lens') {
                  view.lens = !ui.lens
                  ui.set({ lens: !ui.lens })
                } else {
                  ui.set({ tool: t.id, pendingStrand: null })
                  ix.line = null
                }
              }}
            >
              <Icon name={t.icon} />
            </button>
            {hover === t.id && (
              <div className="panel fade-in" style={{ position: 'absolute', left: 52, top: -4, width: 270, padding: '10px 12px', pointerEvents: 'none' }}>
                <div className="row">
                  <strong>{t.name}</strong>
                  <div className="spacer" />
                  <span className="kbd">{t.key}</span>
                </div>
                <div style={{ marginTop: 4, lineHeight: 1.4 }}>{t.does}</div>
                <div className="faint" style={{ marginTop: 6, fontSize: '0.9em' }}>
                  Without dragging: {t.keyboard}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const SEEDS: { id: SeedKind; label: string; law?: keyof Laws }[] = [
  { id: 'white', label: 'Light' },
  { id: 'black', label: 'Dark' },
  { id: 'grey', label: 'Grey', law: 'mediators' },
  { id: 'crystal', label: 'Crystal', law: 'crystals' },
  { id: 'life', label: 'Life', law: 'life' }
]

export function ToolOptions() {
  const ui = useUI()
  const info = ui.info
  const t = TOOL_BY_ID.get(ui.tool)
  if (!t) return null
  let body: React.ReactElement | null = null
  if (ui.tool === 'seed') {
    body = (
      <>
        {SEEDS.filter((s) => !(s.id === 'life' && ui.spec?.mode === 'genesis')).map((s) => {
          const ok = !s.law || info?.laws[s.law]
          return (
            <Btn key={s.id} small active={ui.seedKind === s.id} disabled={!ok} title={ok ? `Place ${s.label.toLowerCase()}` : 'The medium does not know this yet.'} onClick={() => ui.set({ seedKind: s.id })} testid={`seed-${s.id}`}>
              {s.label}
            </Btn>
          )
        })}
        {['white', 'black', 'grey'].includes(ui.seedKind) && (
          <label className="row" style={{ gap: 6 }} title="How much medium to put there">
            <span className="muted">Size</span>
            <input type="range" min={0.3} max={3} step={0.1} value={ui.seedMass} onChange={(e) => ui.set({ seedMass: Number(e.target.value) })} style={{ width: 90 }} />
          </label>
        )}
        {ui.seedKind === 'life' && (
          <select value={ui.sporeType} onChange={(e) => ui.set({ sporeType: e.target.value })} title="What kind of life to seed">
            {Object.keys(ARCHETYPES).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
      </>
    )
  } else if (ui.tool === 'pulse') {
    body = (
      <label className="row" style={{ gap: 6 }} title="How strong a click is; holding makes it stronger">
        <span className="muted">Strength</span>
        <input type="range" min={1} max={10} step={0.5} value={ui.pulseStrength} onChange={(e) => ui.set({ pulseStrength: Number(e.target.value) })} style={{ width: 110 }} />
      </label>
    )
  } else if (ui.tool === 'veil') {
    const flags: [number, string][] = [
      [1, 'Light'],
      [2, 'Vibration'],
      [4, 'Forces'],
      [8, 'Strand flow'],
      [16, 'Living forms']
    ]
    body = (
      <>
        <span className="muted">Shields from:</span>
        {flags.map(([f, l]) => (
          <Btn key={f} small active={(ui.veilMask & f) !== 0} onClick={() => ui.set({ veilMask: ui.veilMask ^ f })} title={`Block ${l.toLowerCase()} from crossing the veil`}>
            {l}
          </Btn>
        ))}
        <label className="row" style={{ gap: 6 }} title="How long the veil lasts">
          <span className="muted">{ui.veilSeconds}s</span>
          <input type="range" min={5} max={300} step={5} value={ui.veilSeconds} onChange={(e) => ui.set({ veilSeconds: Number(e.target.value) })} style={{ width: 80 }} />
        </label>
      </>
    )
  } else if (ui.tool === 'anchor') {
    const flags: [number, string][] = [
      [1, 'Place'],
      [2, 'Rhythm'],
      [4, 'Energy']
    ]
    body = (
      <>
        <span className="muted">Hold its:</span>
        {flags.map(([f, l]) => (
          <Btn key={f} small active={(ui.anchorFlags & f) !== 0} onClick={() => ui.set({ anchorFlags: ui.anchorFlags ^ f || 1 })} title={`Hold its ${l.toLowerCase()} fixed`}>
            {l}
          </Btn>
        ))}
      </>
    )
  }
  return (
    <div className="panel row fade-in" style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', padding: '7px 12px', gap: 8, zIndex: 21, maxWidth: 'min(600px, 46vw)', flexWrap: 'wrap' }} data-testid="tool-options">
      <strong>{t.name}</strong>
      <span className="muted" style={{ maxWidth: body ? 260 : 520, lineHeight: 1.35 }}>
        {ui.pendingStrand !== null ? 'Now click where the strand should go (Esc to cancel).' : t.does}
      </span>
      {body}
    </div>
  )
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]

export function TimeBar({ onCheckpoint, onBranch }: { onCheckpoint: () => void; onBranch: () => void }) {
  const paused = useUI((s) => s.paused)
  const speed = useUI((s) => s.speed)
  const info = useUI((s) => s.info)
  const [autos, setAutos] = useState<{ index: number; tick: number }[]>([])
  const [showRewind, setShowRewind] = useState(false)
  const setPaused = (p: boolean) => {
    if (view.host) view.host.paused = p
    useUI.getState().set({ paused: p })
  }
  const setSpeed = (s: number) => {
    if (view.host) view.host.speed = s
    useUI.getState().set({ speed: s })
  }
  useEffect(() => {
    const p = () => setPaused(!useUI.getState().paused)
    const st = () => {
      setPaused(true)
      view.host?.stepOnce(1)
    }
    const sp = (e: Event) => {
      const d = (e as CustomEvent).detail as number
      const i = SPEEDS.indexOf(useUI.getState().speed)
      setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + d))])
    }
    window.addEventListener('polaritium:pause', p)
    window.addEventListener('polaritium:step', st)
    window.addEventListener('polaritium:speed', sp)
    return () => {
      window.removeEventListener('polaritium:pause', p)
      window.removeEventListener('polaritium:step', st)
      window.removeEventListener('polaritium:speed', sp)
    }
  }, [])
  const eff = view.host?.effective ?? 1
  return (
    <div className="panel row" style={{ position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', padding: '7px 10px', gap: 6, zIndex: 20 }} data-testid="time-bar">
      <Btn small kind="ghost" title={paused ? 'Run (Space)' : 'Pause (Space)'} onClick={() => setPaused(!paused)} testid="pause">
        <Icon name={paused ? 'play' : 'pause'} size={16} />
      </Btn>
      <Btn small kind="ghost" title="Advance exactly one tick (.)" onClick={() => window.dispatchEvent(new CustomEvent('polaritium:step'))} testid="step">
        <Icon name="step" size={16} />
      </Btn>
      {SPEEDS.map((s) => (
        <Btn key={s} small active={speed === s} kind="ghost" onClick={() => setSpeed(s)} title={`${s}× speed`}>
          {s < 1 ? `${s}×` : `${s}×`}
        </Btn>
      ))}
      <div className="col" style={{ gap: 0, minWidth: 92, textAlign: 'center' }} title="Simulation time: ticks (30 a second) and cycles (60 ticks)">
        <span>{formatTime(info?.tick ?? 0)}</span>
        <span className="faint" style={{ fontSize: '0.8em' }}>
          cycle {Math.floor((info?.tick ?? 0) / 60)} {!paused && speed > 1 && eff < speed * 0.8 ? `· running ${eff.toFixed(1)}×` : ''}
        </span>
      </div>
      <Btn small kind="ghost" title="Undo your last action (Ctrl+Z): restores the exact earlier state" onClick={() => void undoRedo('undo')} disabled={!info?.canUndo}>
        <Icon name="undo" size={16} />
      </Btn>
      <Btn small kind="ghost" title="Redo (Ctrl+Y)" onClick={() => void undoRedo('redo')} disabled={!info?.canRedo}>
        <Icon name="redo" size={16} />
      </Btn>
      <Btn
        small
        kind="ghost"
        title="Return to an earlier moment (the universe keeps a snapshot every 10 seconds)"
        onClick={async () => {
          setAutos((await view.host?.req<{ index: number; tick: number }[]>('autos')) ?? [])
          setShowRewind(!showRewind)
        }}
        testid="rewind"
      >
        <Icon name="time" size={16} />
      </Btn>
      <Btn small kind="ghost" title="Save a named checkpoint of this exact moment" onClick={onCheckpoint} testid="checkpoint">
        <Icon name="flag" size={16} />
      </Btn>
      <Btn small kind="ghost" title="Branch: start a separate experiment from a checkpoint, to try something different" onClick={onBranch} testid="branch">
        <Icon name="branch" size={16} />
      </Btn>
      {showRewind && autos.length > 0 && (
        <div className="panel col fade-in" style={{ position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)', padding: 12, width: 420 }}>
          <span>Return to an earlier moment. This restores the universe exactly as it was then; what happened after is undone (Ctrl+Z brings it back).</span>
          <input
            type="range"
            min={0}
            max={autos.length - 1}
            step={1}
            defaultValue={autos.length - 1}
            onChange={async (e) => {
              const i = Number(e.target.value)
              await view.host?.req('rewind', { index: autos[i].index })
              view.host?.refresh()
            }}
          />
          <div className="row faint" style={{ justifyContent: 'space-between' }}>
            <span>{formatTime(autos[0].tick)}</span>
            <span>{formatTime(autos[autos.length - 1].tick)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function ChamberPanel({ onRestart, onLeave }: { onRestart: () => void; onLeave: () => void }) {
  const info = useUI((s) => s.info)
  const spec = useUI((s) => s.spec)
  const [hint, setHint] = useState(0)
  const def = spec?.chamber ? CHAMBER_BY_ID.get(spec.chamber) : null
  if (!def) return null
  const st = info?.chamber
  return (
    <div className="panel col" style={{ position: 'absolute', left: 70, top: 72, width: 320, padding: 14, zIndex: 20 }} data-testid="chamber-panel">
      <span className="caps">Paradox Chamber {def.num}</span>
      <span className="display" style={{ fontSize: '1.6em' }}>
        {def.title}
      </span>
      <span style={{ lineHeight: 1.4 }}>{def.goal}</span>
      <Bar value={st?.progress ?? 0} />
      <span className="muted" data-testid="chamber-note">
        {st?.done ? 'Solved.' : st?.failed ? st.failed : st?.note || ' '}
      </span>
      {hint > 0 && (
        <div className="col" style={{ gap: 4 }}>
          {def.hints.slice(0, hint).map((h, i) => (
            <span key={i} className="faint">
              {i + 1}. {h}
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {hint < def.hints.length && !st?.done && (
          <Btn small onClick={() => setHint(hint + 1)} title="Show one more hint">
            Hint
          </Btn>
        )}
        <Btn small onClick={onRestart} title="Start this chamber again from the beginning">
          Restart
        </Btn>
        <Btn small kind="ghost" onClick={onLeave} title="Back to the list of chambers">
          Chambers
        </Btn>
      </div>
    </div>
  )
}

export function GenesisPanel() {
  const info = useUI((s) => s.info)
  if (!info || info.mode !== 'genesis') return null
  const order: (keyof Laws)[] = ['phase', 'mediators', 'crystals', 'membranes', 'life', 'adaptation']
  const names: Record<keyof Laws, string> = { phase: 'Rhythm', mediators: 'Mediation', crystals: 'Form', membranes: 'Enclosure', life: 'Life', adaptation: 'Change' }
  const next = order.find((l) => !info.laws[l])
  return (
    <div className="panel col" style={{ position: 'absolute', left: 70, top: 72, width: 300, padding: 12, zIndex: 20 }} data-testid="genesis-panel">
      <span className="caps">Genesis · laws of the medium</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {order.map((l) => (
          <span key={l} className="kbd" style={{ color: info.laws[l] ? '#fff' : undefined, borderColor: info.laws[l] ? 'rgba(255,255,255,0.6)' : undefined }} title={LAW_TEXT[l]}>
            {names[l]}
          </span>
        ))}
      </div>
      <span className="faint" style={{ lineHeight: 1.4 }}>
        {next ? 'Each discovery wakes a new law. Light, dark and attraction are all there is for now.' : 'Every law of the medium is awake.'}
      </span>
    </div>
  )
}

export function TopBar(props: { title: string; env: string; onMenu: () => void; onSave: () => void; onPhoto: () => void; onAi: () => void; onHelp: () => void }) {
  const sight = useUI((s) => s.sight)
  const lens = useUI((s) => s.lens)
  const info = useUI((s) => s.info)
  return (
    <>
    <div className="panel col" style={{ position: 'absolute', left: 14, top: 14, padding: '6px 12px', gap: 0, zIndex: 22, maxWidth: 300 }} title="This experiment" data-testid="title-panel">
      <span className="display" style={{ fontSize: '1.2em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {props.title}
      </span>
      <span className="faint">{envOf((info?.env ?? props.env) as never).name}</span>
    </div>
    <div className="row" style={{ position: 'absolute', right: 14, top: 14, gap: 6, zIndex: 22 }}>
      <Btn small active={sight} title="Strand Sight (Tab): quiets everything else and shows the network of relationships" onClick={() => {
        view.sight = !sight
        useUI.getState().set({ sight: !sight })
      }} testid="strand-sight">
        <Icon name="sight" size={16} />
      </Btn>
      <Btn small active={lens} title="Lens (L): reveals light, vibration and forces" onClick={() => {
        view.lens = !lens
        useUI.getState().set({ lens: !lens })
      }}>
        <Icon name="lens" size={16} />
      </Btn>
      <Btn small title="Take a picture to save or share (P)" onClick={props.onPhoto} testid="photo">
        <Icon name="photo" size={16} />
      </Btn>
      <Btn small title="Save this experiment now (Ctrl+S)" onClick={props.onSave} testid="save">
        <Icon name="save" size={16} />
      </Btn>
      <Btn small title="Optional AI: interpretation, suggestions, names, captions" onClick={props.onAi} testid="ai-button">
        <Icon name="spark" size={16} />
      </Btn>
      <Btn small title="Controls and help (H)" onClick={props.onHelp}>
        <Icon name="help" size={16} />
      </Btn>
      <Btn small title="Menu (Esc)" onClick={props.onMenu} testid="game-menu">
        <Icon name="menu" size={16} />
      </Btn>
    </div>
    </>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const captions = useUI((s) => s.captions)
  return (
    <>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className="panel toast fade-in" data-testid={t.kind === 'discovery' ? 'discovery-toast' : 'toast'} style={{ borderColor: t.kind === 'discovery' || t.kind === 'law' ? 'rgba(255,255,255,0.45)' : undefined }}>
            {t.kind === 'discovery' && <div className="caps">Discovered</div>}
            {t.kind === 'law' && <div className="caps">A law wakes</div>}
            <div className={t.kind === 'discovery' ? 'display' : ''} style={{ fontSize: t.kind === 'discovery' ? '1.5em' : undefined }}>
              {t.text}
            </div>
            {t.entry && <div className="muted" style={{ marginTop: 2 }}>{t.entry.line}</div>}
          </div>
        ))}
      </div>
      {captions.length > 0 && (
        <div className="panel caption">{captions[captions.length - 1].text}</div>
      )}
    </>
  )
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Look around', 'Right-drag (or left-drag on empty space with the Hand)'],
    ['Pan', 'Middle-drag, or Shift + right-drag'],
    ['Zoom', 'Mouse wheel (toward the pointer)'],
    ['Fly', 'W A S D, Q and E (Shift: faster)'],
    ['Focus / follow', 'F focuses the selection; G follows it'],
    ['Previous view', 'Backspace'],
    ['Cinematic camera', 'C'],
    ['Tools', '1 – 0, L for Lens, K for Anchor'],
    ['Strand Sight', 'Tab'],
    ['Pause, step, speed', 'Space, full stop, [ and ]'],
    ['Undo / redo', 'Ctrl+Z / Ctrl+Y'],
    ['Adjust selection', '+ and − (Alt: resistance); arrow keys move it'],
    ['Picture', 'P'],
    ['Save', 'Ctrl+S'],
    ['Menu', 'Esc']
  ]
  return (
    <div className="panel fade-in scroll" style={{ position: 'absolute', right: 14, top: 64, width: 380, maxHeight: 'calc(100% - 160px)', padding: 16, zIndex: 30 }} data-testid="help">
      <div className="row">
        <span className="display" style={{ fontSize: '1.5em' }}>
          Controls
        </span>
        <div className="spacer" />
        <Btn small kind="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
      <table style={{ width: '100%', marginTop: 6 }}>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <td className="muted" style={{ padding: '3px 8px 3px 0', verticalAlign: 'top' }}>
                {a}
              </td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="soft" />
      <div className="col" style={{ gap: 6, lineHeight: 1.4 }}>
        <span className="caps">How the medium works</span>
        <span>Light emits energy. Dark absorbs it. Grey mediates: it gathers energy and releases it in beats.</span>
        <span>Strands carry energy from high to low. Their ends have rhythms; when the rhythms fall into step the strand resonates.</span>
        <span>Too much at once and things break. What breaks is not always the end of something.</span>
      </div>
    </div>
  )
}
