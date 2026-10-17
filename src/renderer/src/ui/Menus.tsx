import { useEffect, useState } from 'react'
import type { ChamberProgress, UniverseMeta } from '@core/app/bridge'
import { CHAMBERS } from '@core/sim/chambers'
import { ENVIRONMENTS, PLAYABLE_ENVS } from '@core/sim/environments'
import { PRESETS } from '@core/sim/presets'
import type { EnvId } from '@core/sim/types'
import { audio } from '../audio/engine'
import { bridge } from '../bridge'
import { Scene } from '../scene/Scene'
import { resetView, view } from '../scene/shared'
import { SimHost } from '../sim/host'
import { useUI } from '../state/store'
import { Btn, ScreenHeader, formatTime } from './primitives'

function randomSeed(): string {
  const words = ['ash', 'vesper', 'quill', 'lumen', 'ember', 'hollow', 'tide', 'thread', 'calyx', 'orrin', 'nadir', 'sable', 'argent', 'velum']
  const a = new Uint32Array(2)
  crypto.getRandomValues(a)
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${(a[0] % 900) + 100}`
}

function MenuBackdrop() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = new SimHost()
    resetView()
    view.host = host
    host.wantFields = true
    void host.create({ seed: 'menu-backdrop', env: 'cradle', mode: 'lab', preset: 'choir', density: 1 }).then(async () => {
      await host.cmd({ type: 'seed', kind: 'black', p: { x: 0, y: -10, z: 4 }, mass: 1.6 }, false)
      await host.cmd({ type: 'seed', kind: 'white', p: { x: -22, y: 6, z: -12 }, mass: 0.8 }, false)
      setReady(true)
    })
    return () => {
      host.dispose()
      if (view.host === host) view.host = null
    }
  }, [])
  return ready ? <Scene env="cradle" interactive={false} pose={{ position: [34, 14, 46], target: [0, 0, 0] }} /> : null
}

export function MainMenu() {
  const [universes, setUniverses] = useState<UniverseMeta[]>([])
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const settings = useUI((s) => s.settings)
  const finishRename = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (name) await bridge.universes.rename(renaming.id, name.slice(0, 60))
    setRenaming(null)
    setUniverses(await bridge.universes.list())
  }
  useEffect(() => {
    void bridge.universes.list().then(setUniverses)
  }, [])
  const last = universes.find((u) => u.id === settings.lastUniverse) ?? universes[0]
  const go = (screen: Parameters<ReturnType<typeof useUI.getState>['set']>[0]['screen']) => useUI.getState().set({ screen })
  const openUniverse = async (u: UniverseMeta) => {
    const r = await bridge.universes.load(u.id)
    if (!r.ok || !r.value) {
      useUI.getState().toast(`That universe could not be opened: ${r.error}`, 'warn')
      return
    }
    if (r.recovered) useUI.getState().toast('The latest save was damaged, so the previous good save was opened instead.', 'warn')
    useUI.getState().set({
      screen: 'game',
      spec: { mode: u.mode === 'genesis' ? 'genesis' : 'lab', env: u.env as EnvId, preset: u.preset, seed: u.seed, density: 1, name: u.name, chamber: null, loadState: r.value.state, universe: r.value.meta }
    })
  }
  const startGenesis = () => {
    useUI.getState().set({ screen: 'game', spec: { mode: 'genesis', env: 'genesis', preset: 'twin', seed: randomSeed(), density: 1, name: 'Genesis', chamber: null, universe: null } })
  }
  const items: { label: string; line: string; onClick: () => void; disabled?: boolean; testid: string }[] = [
    { label: 'Continue', line: last ? `Return to “${last.name}” (${formatTime(last.tick)})` : 'Nothing saved yet', onClick: () => last && void openUniverse(last), disabled: !last, testid: 'menu-continue' },
    { label: 'New Experiment', line: 'The open Laboratory: any environment, any starting system', onClick: () => go('new'), testid: 'menu-new' },
    { label: 'Genesis', line: 'Begin with almost nothing; each discovery wakes a new law', onClick: startGenesis, testid: 'menu-genesis' },
    { label: 'Paradox Chambers', line: 'Twelve questions with real answers', onClick: () => go('chambers'), testid: 'menu-chambers' },
    { label: 'Living Gallery', line: 'Your saved moments, to revisit and resume', onClick: () => go('gallery'), testid: 'menu-gallery' },
    { label: 'Discovery Atlas', line: 'Everything you have found', onClick: () => go('atlas'), testid: 'menu-atlas' },
    { label: 'Compare', line: 'Two branches of an experiment, side by side', onClick: () => go('compare'), testid: 'menu-compare' },
    { label: 'Settings', line: 'Graphics, sound, controls, accessibility, optional AI', onClick: () => go('settings'), testid: 'menu-settings' },
    { label: 'Exit', line: '', onClick: () => void bridge.app.quit(), testid: 'menu-exit' }
  ]
  return (
    <div className="screen" data-testid="main-menu">
      <MenuBackdrop />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(5,5,6,0.92) 0%, rgba(5,5,6,0.55) 36%, rgba(5,5,6,0) 62%)', pointerEvents: 'none' }} />
      <div className="col fade-in" style={{ position: 'absolute', left: '6vw', top: '7vh', gap: 2, width: 440 }}>
        <div className="display" style={{ fontSize: '4.6em', letterSpacing: '0.14em', lineHeight: 1 }}>
          POLARITIUM
        </div>
        <div className="muted" style={{ fontSize: '1.08em', marginBottom: 16, lineHeight: 1.5 }}>
          Reach into a universe of opposing forces, connect them, and see what emerges.
        </div>
        {items.map((it) => (
          <button
            key={it.label}
            className="btn ghost"
            data-testid={it.testid}
            disabled={it.disabled}
            onClick={() => {
              audio.start()
              audio.ui('open')
              it.onClick()
            }}
            style={{ justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', gap: 0, padding: '4px 10px', opacity: it.disabled ? 0.4 : 1 }}
          >
            <span className="display" style={{ fontSize: '1.4em' }}>
              {it.label}
            </span>
            {it.line && <span className="faint">{it.line}</span>}
          </button>
        ))}
      </div>
      {(
        <div className="panel col fade-in scroll" style={{ position: 'absolute', right: 24, bottom: 44, width: 360, maxHeight: '42vh', padding: 12 }} data-testid="universe-list">
          <span className="caps">Your universes</span>
          {!universes.length && <span className="faint">Nothing saved yet. Every experiment you start is kept here.</span>}
          {universes.map((u) => (
            <div key={u.id} className="row" style={{ gap: 4 }}>
              {renaming?.id === u.id ? (
                <input
                  type="text"
                  value={renaming.name}
                  autoFocus
                  maxLength={60}
                  onChange={(e) => setRenaming({ id: u.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void finishRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => void finishRename()}
                  style={{ flex: 1 }}
                  aria-label="New name"
                />
              ) : (
                <button className="btn ghost" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => void openUniverse(u)} title="Open this universe">
                  {u.name} <span className="faint">{formatTime(u.tick)}</span>
                </button>
              )}
              <Btn small kind="ghost" title="Rename this universe" onClick={() => setRenaming({ id: u.id, name: u.name })}>
                Rename
              </Btn>
              <Btn
                small
                kind="ghost"
                title="Save this universe as a .polaritium file you can keep or share"
                onClick={async () => {
                  const r = await bridge.universes.exportFile(u.id)
                  if (r.ok) useUI.getState().toast(r.value ? `Exported to ${r.value}` : 'Exported.', 'info')
                  else if (r.error) useUI.getState().toast(`Could not export: ${r.error}`, 'warn')
                }}
              >
                Export
              </Btn>
              <Btn
                small
                kind="ghost"
                title="Delete this universe (its saved file is removed)"
                onClick={async () => {
                  if (!confirm(`Delete “${u.name}”? This removes its save and its checkpoints.`)) return
                  await bridge.universes.remove(u.id)
                  setUniverses(await bridge.universes.list())
                }}
              >
                ✕
              </Btn>
            </div>
          ))}
          <Btn
            small
            onClick={async () => {
              const r = await bridge.universes.importFile()
              if (r.ok) setUniverses(await bridge.universes.list())
              else if (r.error) useUI.getState().toast(r.error, 'warn')
            }}
            title="Open a .polaritium file someone shared, or one you exported"
          >
            Import a universe file
          </Btn>
        </div>
      )}
      <div className="faint" style={{ position: 'absolute', right: 24, bottom: 14, fontSize: '0.9em' }}>
        Made by Greygray · The Grey Strand provides the philosophy; Polaritium provides the playground.
      </div>
    </div>
  )
}

export function NewExperiment() {
  const [env, setEnv] = useState<EnvId>('cradle')
  const [preset, setPreset] = useState('twin')
  const [seed, setSeed] = useState(randomSeed())
  const [density, setDensity] = useState(1)
  const [name, setName] = useState('')
  const start = () => {
    useUI.getState().set({
      screen: 'game',
      spec: { mode: 'lab', env, preset, seed, density, name: name.trim() || `${ENVIRONMENTS[env].name.replace('The ', '')} · ${seed}`, chamber: null, universe: null }
    })
  }
  return (
    <div className="screen" data-testid="new-experiment" style={{ background: 'radial-gradient(ellipse at 70% 30%, #101015 0%, #050506 65%)' }}>
      <ScreenHeader title="New Experiment" line="Choose where to begin and what to begin with. The Laboratory has no goals: everything is allowed." onBack={() => useUI.getState().set({ screen: 'menu' })} />
      <div className="scroll" style={{ flex: 1, padding: '6px 28px 28px' }}>
        <div className="caps" style={{ margin: '8px 0' }}>
          Environment
        </div>
        <div className="grid-cards">
          {PLAYABLE_ENVS.map((id) => {
            const e = ENVIRONMENTS[id]
            return (
              <button key={id} className={`card ${env === id ? 'selected' : ''}`} onClick={() => setEnv(id)} data-testid={`env-${id}`}>
                <div className="display" style={{ fontSize: '1.35em' }}>
                  {e.name}
                </div>
                <div className="muted" style={{ margin: '4px 0 6px', lineHeight: 1.4 }}>
                  {e.line}
                </div>
                {e.distinct.map((d) => (
                  <div key={d} className="faint" style={{ fontSize: '0.9em', lineHeight: 1.35 }}>
                    · {d}
                  </div>
                ))}
              </button>
            )
          })}
        </div>
        <div className="caps" style={{ margin: '18px 0 8px' }}>
          Starting system
        </div>
        <div className="grid-cards">
          {PRESETS.map((p) => (
            <button key={p.id} className={`card ${preset === p.id ? 'selected' : ''}`} onClick={() => setPreset(p.id)} data-testid={`preset-${p.id}`}>
              <div className="display" style={{ fontSize: '1.25em' }}>
                {p.name}
              </div>
              <div className="muted" style={{ marginTop: 4, lineHeight: 1.4 }}>
                {p.line}
              </div>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 20, gap: 14, flexWrap: 'wrap' }}>
          <label className="col" style={{ gap: 4 }} title="The same seed and the same actions always give the same universe">
            <span className="muted">Seed</span>
            <span className="row">
              <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: 200 }} />
              <Btn small onClick={() => setSeed(randomSeed())} title="Pick a new random seed">
                New seed
              </Btn>
            </span>
          </label>
          {preset === 'scatter' && (
            <label className="col" style={{ gap: 4 }} title="How much medium the scattering starts with">
              <span className="muted">Density</span>
              <select value={density} onChange={(e) => setDensity(Number(e.target.value))}>
                <option value={0.6}>Sparse</option>
                <option value={1}>Normal</option>
                <option value={1.8}>Rich</option>
              </select>
            </label>
          )}
          <label className="col" style={{ gap: 4 }}>
            <span className="muted">Name (optional)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Untitled experiment" style={{ width: 240 }} />
          </label>
          <div className="spacer" />
          <Btn kind="primary" onClick={start} testid="start-experiment" style={{ padding: '11px 26px', fontSize: '1.08em' }}>
            Begin
          </Btn>
        </div>
      </div>
    </div>
  )
}

export function ChambersScreen() {
  const [progress, setProgress] = useState<Record<string, ChamberProgress>>({})
  useEffect(() => {
    void bridge.chambers.progress().then(setProgress)
  }, [])
  const solved = CHAMBERS.filter((c) => progress[c.id]?.solved).length
  return (
    <div className="screen" data-testid="chambers" style={{ background: 'radial-gradient(ellipse at 30% 20%, #101015 0%, #050506 65%)' }}>
      <ScreenHeader title="Paradox Chambers" line={`Each chamber asks one question of the medium, and checks your answer. ${solved} of ${CHAMBERS.length} solved.`} onBack={() => useUI.getState().set({ screen: 'menu' })} />
      <div className="scroll" style={{ flex: 1, padding: '6px 28px 28px' }}>
        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {CHAMBERS.map((c) => {
            const p = progress[c.id]
            return (
              <button
                key={c.id}
                className="card"
                data-testid={`chamber-${c.id}`}
                onClick={() => {
                  audio.start()
                  useUI.getState().set({ screen: 'game', spec: { mode: 'chamber', env: c.env, preset: 'empty', seed: 'chamber', density: 1, name: c.title, chamber: c.id, universe: null } })
                }}
              >
                <div className="row">
                  <span className="caps">Chamber {c.num}</span>
                  <div className="spacer" />
                  {p?.solved ? <span style={{ color: '#fff' }}>Solved{p.bestSeconds !== null ? ` · ${p.bestSeconds}s` : ''}</span> : p?.attempts ? <span className="faint">Tried</span> : null}
                </div>
                <div className="display" style={{ fontSize: '1.4em', margin: '2px 0' }}>
                  {c.title}
                </div>
                <div style={{ lineHeight: 1.4 }}>{c.goal}</div>
                <div className="faint" style={{ marginTop: 6 }}>
                  {ENVIRONMENTS[c.env].name}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
