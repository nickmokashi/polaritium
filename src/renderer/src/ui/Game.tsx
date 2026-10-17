import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtlasEntry } from '@core/app/atlas'
import type { CheckpointMeta, UniverseMeta } from '@core/app/bridge'
import { CHAMBER_BY_ID } from '@core/sim/chambers'
import { DISCOVERY_BY_ID, LAW_TEXT } from '@core/sim/discovery'
import { RULES_VERSION } from '@core/sim/constants'
import type { Laws, SimEvent } from '@core/sim/types'
import { audio } from '../audio/engine'
import { bridge } from '../bridge'
import { cam, currentPose } from '../scene/camera'
import { capture, Scene } from '../scene/Scene'
import { pushFx } from '../scene/FxLayer'
import { resetView, view } from '../scene/shared'
import { SimHost } from '../sim/host'
import { useUI } from '../state/store'
import { AiPanel } from './AiPanel'
import { ExportDialog } from './ExportDialog'
import { ChamberPanel, GenesisPanel, HelpOverlay, TimeBar, Toasts, ToolOptions, ToolRail, TopBar } from './Hud'
import { Inspector } from './Inspector'
import { Btn, Modal, formatTime, uid } from './primitives'
import { Tutorial } from './Tutorial'

// A running experiment: the 3D view, the tools, the inspector and time, plus everything that
// keeps it safe (autosave, checkpoints, branches) and everything it finds (the Atlas).

export async function snapshotThumb(w = 360, h = 220): Promise<string | null> {
  if (capture.now) {
    try {
      const d = capture.now(w, h)
      if (d) return d
    } catch {
      /* fall back to the next frame */
    }
  }
  return new Promise((resolve) => {
    capture.pending = { width: w, height: h, resolve: (d) => resolve(d) }
    setTimeout(() => resolve(null), 1500)
  })
}

export function Game() {
  const spec = useUI((s) => s.spec)!
  const helpOpen = useUI((s) => s.helpOpen)
  const universe = useUI((s) => s.universe)
  const [ready, setReady] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<null | 'photo' | 'ai' | 'checkpoint' | 'branch' | 'solved'>(null)
  const [cpName, setCpName] = useState('')
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([])
  const metaRef = useRef<UniverseMeta | null>(spec.universe ?? null)
  const hostRef = useRef<SimHost | null>(null)
  const startedAt = useRef(performance.now())
  const solvedRecorded = useRef(false)

  const save = useCallback(async (quiet = false) => {
    const host = hostRef.current
    if (!host || spec.mode === 'chamber' || spec.exhibit) return
    const state = await host.req<string>('serialize')
    const meta = metaRef.current
    if (!meta || !state) return
    const thumb = await snapshotThumb(320, 200)
    const next: UniverseMeta = { ...meta, tick: host.info?.tick ?? meta.tick, updated: Date.now(), thumb: thumb ?? meta.thumb, camera: currentPose() }
    const r = await bridge.universes.save(next, state)
    if (r.ok && r.value) {
      metaRef.current = r.value
      useUI.getState().set({ universe: r.value })
      const ui = useUI.getState()
      if (ui.settings.lastUniverse !== r.value.id) void bridge.settings.set({ ...ui.settings, lastUniverse: r.value.id }).then((s) => useUI.getState().set({ settings: s }))
      if (!quiet) useUI.getState().toast('Saved.', 'info')
    } else if (!quiet) useUI.getState().toast(`Could not save: ${r.error ?? 'unknown problem'}`, 'warn')
  }, [spec])

  // Start the universe.
  useEffect(() => {
    metaRef.current = spec.universe ?? null
    solvedRecorded.current = false
    setReady(false)
    useUI.getState().set({ universe: spec.universe ?? null })
    const host = new SimHost()
    hostRef.current = host
    resetView()
    view.host = host
    cam.follow = null
    cam.cinematic = false
    const ui = useUI.getState()
    ui.set({ paused: false, speed: 1, selection: [], reading: null, sight: false, lens: false, tool: 'hand', pendingStrand: null })
    view.sight = false
    view.lens = false
    host.onEvents = (events: SimEvent[]) => {
      pushFx(events)
      for (const e of events) {
        audio.event(e)
        if (e.type === 'law' && e.text) useUI.getState().toast(LAW_TEXT[e.text as keyof Laws], 'law')
      }
    }
    host.onFindings = (entries: AtlasEntry[]) => void recordFindings(entries)
    host.onInfo = (info) => {
      useUI.getState().set({ info })
      if (info.chamber?.done && !solvedRecorded.current && spec.chamber) {
        solvedRecorded.current = true
        void bridge.chambers.record(spec.chamber, true, Math.round(info.tick / 30))
        audio.event({ t: 0, type: 'finding', x: 0, y: 0, z: 0 })
        setDialog('solved')
      }
    }
    const start = async () => {
      if (spec.chamber) void bridge.chambers.record(spec.chamber, false, null)
      if (spec.loadState) await host.load(spec.loadState)
      else await host.create({ seed: spec.seed, env: spec.env, mode: spec.mode === 'chamber' ? 'chamber' : spec.mode, preset: spec.preset, density: spec.density, chamber: spec.chamber })
      if (!metaRef.current && spec.mode !== 'chamber' && !spec.exhibit) {
        metaRef.current = {
          id: uid(),
          name: spec.name,
          env: spec.env,
          mode: spec.mode === 'genesis' ? 'genesis' : 'lab',
          preset: spec.preset,
          seed: spec.seed,
          created: Date.now(),
          updated: Date.now(),
          tick: 0,
          parent: null,
          parentCheckpoint: null,
          thumb: null,
          notes: '',
          chamber: null,
          rules: RULES_VERSION,
          camera: null
        }
      }
      host.setUniverse(metaRef.current?.id ?? null, metaRef.current?.name ?? spec.name)
      useUI.getState().set({ universe: metaRef.current })
      audio.setEnvironment(spec.env)
      setReady(true)
      startedAt.current = performance.now()
      if (metaRef.current) setTimeout(() => void save(true), 4000)
    }
    void start().catch((e) => {
      useUI.getState().toast(`This universe could not be opened: ${(e as Error).message}`, 'warn')
      useUI.getState().set({ screen: 'menu' })
    })
    return () => {
      host.dispose()
      if (view.host === host) view.host = null
      audio.setVoices([])
      audio.setEnvironment(null)
    }
  }, [spec])

  const recordFindings = async (entries: AtlasEntry[]) => {
    for (const e of entries) {
      const { entry, isNew } = await bridge.atlas.record(e)
      if (isNew) {
        useUI.getState().toast(entry.name, 'discovery', entry)
        const img = await snapshotThumb(480, 300)
        if (img) await bridge.atlas.update(entry.id, { image: img })
      }
    }
    useUI.getState().set({ atlas: await bridge.atlas.list() })
  }

  // A hidden window (the self-test and the desktop tests) gets almost no animation frames, so
  // there the simulation is paced by a timer instead. Normal play never uses this.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('hidden')) return
    let last = performance.now()
    const t = setInterval(() => {
      const now = performance.now()
      hostRef.current?.frame(Math.min(0.1, (now - last) / 1000))
      last = now
    }, 33)
    return () => clearInterval(t)
  }, [spec])

  // Autosave.
  useEffect(() => {
    const minutes = useUI.getState().settings.data.autosaveMinutes
    if (!minutes || spec.mode === 'chamber' || spec.exhibit) return
    const t = setInterval(() => void save(true), minutes * 60_000)
    return () => clearInterval(t)
  }, [spec, save])

  // Keyboard events routed from the scene.
  useEffect(() => {
    const onSave = () => void save(false)
    const onPhoto = () => setDialog('photo')
    const onMenu = () => setMenu((m) => !m)
    window.addEventListener('polaritium:save', onSave)
    window.addEventListener('polaritium:photo', onPhoto)
    window.addEventListener('polaritium:menu', onMenu)
    return () => {
      window.removeEventListener('polaritium:save', onSave)
      window.removeEventListener('polaritium:photo', onPhoto)
      window.removeEventListener('polaritium:menu', onMenu)
    }
  }, [save])

  const leave = async (to: 'menu' | 'chambers' | 'gallery' = 'menu') => {
    await save(true)
    useUI.getState().set({ screen: to, spec: null })
  }

  const openCheckpoint = async () => {
    setCpName(`Checkpoint at ${formatTime(view.host?.info?.tick ?? 0)}`)
    setDialog('checkpoint')
  }

  const saveCheckpoint = async () => {
    const host = hostRef.current
    const meta = metaRef.current
    if (!host || !meta) {
      useUI.getState().toast('Checkpoints are kept for Laboratory and Genesis experiments.', 'info')
      setDialog(null)
      return
    }
    await save(true)
    const state = await host.req<string>('serialize')
    const thumb = await snapshotThumb(240, 150)
    const cp: CheckpointMeta = { id: uid(), universeId: meta.id, label: cpName || 'Checkpoint', tick: host.info?.tick ?? 0, created: Date.now(), thumb }
    const r = await bridge.universes.saveCheckpoint(cp, state)
    useUI.getState().toast(r.ok ? `Checkpoint saved: ${cp.label}.` : `Could not save the checkpoint: ${r.error}`, r.ok ? 'info' : 'warn')
    setDialog(null)
  }

  const openBranch = async () => {
    const meta = metaRef.current
    if (!meta) {
      useUI.getState().toast('Branches are made from Laboratory and Genesis experiments.', 'info')
      return
    }
    setCheckpoints(await bridge.universes.checkpoints(meta.id))
    setDialog('branch')
  }

  const branchFrom = async (cp: CheckpointMeta | null) => {
    const meta = metaRef.current
    const host = hostRef.current
    if (!meta || !host) return
    await save(true)
    let state: string | null = null
    if (cp) {
      const r = await bridge.universes.loadCheckpoint(cp.id)
      if (!r.ok || !r.value) {
        useUI.getState().toast(`That checkpoint could not be opened: ${r.error}`, 'warn')
        return
      }
      state = r.value
    } else state = await host.req<string>('serialize')
    const next: UniverseMeta = { ...meta, id: uid(), name: `${meta.name} · branch`, created: Date.now(), updated: Date.now(), parent: meta.id, parentCheckpoint: cp?.id ?? null, tick: cp?.tick ?? host.info?.tick ?? 0 }
    const r = await bridge.universes.save(next, state!)
    if (!r.ok || !r.value) {
      useUI.getState().toast(`The branch could not be made: ${r.error}`, 'warn')
      return
    }
    setDialog(null)
    useUI.getState().toast(`Branched. You are now in "${r.value.name}"; the original is unchanged.`, 'info')
    useUI.getState().set({ spec: { ...spec, name: r.value.name, loadState: state!, universe: r.value } })
  }

  const chamber = spec.chamber ? CHAMBER_BY_ID.get(spec.chamber) : null
  const title = chamber ? chamber.title : spec.exhibit ? spec.exhibit.name : universe?.name ?? spec.name

  return (
    <div className="screen" data-testid="game">
      <Scene env={spec.env} interactive pose={spec.universe?.camera ?? spec.exhibit?.camera ?? null} />
      {ready && (
        <>
          <ToolRail />
          <ToolOptions />
          <TopBar title={title} env={spec.env} onMenu={() => setMenu(true)} onSave={() => void save(false)} onPhoto={() => setDialog('photo')} onAi={() => setDialog('ai')} onHelp={() => useUI.getState().set({ helpOpen: !helpOpen })} />
          <TimeBar onCheckpoint={() => void openCheckpoint()} onBranch={() => void openBranch()} />
          <Inspector />
          {chamber && (
            <ChamberPanel
              onRestart={async () => {
                solvedRecorded.current = false
                await view.host?.req('restartChamber', { seed: `chamber-${Date.now()}` })
                view.host?.refresh()
              }}
              onLeave={() => void leave('chambers')}
            />
          )}
          <GenesisPanel />
          {helpOpen && <HelpOverlay onClose={() => useUI.getState().set({ helpOpen: false })} />}
          <Tutorial />
        </>
      )}
      <Toasts />
      {menu && (
        <Modal title="Paused menu" onClose={() => setMenu(false)} testid="pause-menu">
          <div className="col" style={{ gap: 8 }}>
            <span className="muted">The experiment keeps running behind this menu unless you pause it.</span>
            <Btn onClick={() => setMenu(false)}>Return to the experiment</Btn>
            {!chamber && <Btn onClick={() => void save(false).then(() => setMenu(false))}>Save now</Btn>}
            {!chamber && !spec.exhibit && (
              <Btn
                onClick={async () => {
                  await save(true)
                  const state = await view.host?.req<string>('serialize')
                  const thumb = await snapshotThumb(480, 300)
                  if (state) {
                    const r = await bridge.gallery.save({ id: uid(), name: title, created: Date.now(), thumb, camera: currentPose(), presentation: 'pedestal', notes: '', sourceUniverse: metaRef.current?.id ?? null, env: spec.env }, state)
                    useUI.getState().toast(r.ok ? 'Placed in the Living Gallery.' : `Could not add it: ${r.error}`, 'info')
                  }
                  setMenu(false)
                }}
              >
                Add this moment to the Living Gallery
              </Btn>
            )}
            {chamber && <Btn onClick={() => void leave('chambers')}>Back to the Paradox Chambers</Btn>}
            {spec.exhibit && <Btn onClick={() => void leave('gallery')}>Back to the Living Gallery</Btn>}
            <Btn kind="ghost" onClick={() => void leave('menu')}>
              {chamber || spec.exhibit ? 'Main menu' : 'Save and return to the main menu'}
            </Btn>
          </div>
        </Modal>
      )}
      {dialog === 'photo' && <ExportDialog title={title} onClose={() => setDialog(null)} />}
      {dialog === 'ai' && <AiPanel onClose={() => setDialog(null)} />}
      {dialog === 'checkpoint' && (
        <Modal title="Save a checkpoint" onClose={() => setDialog(null)}>
          <div className="col">
            <span className="muted">A checkpoint keeps this exact moment. Later you can branch a new experiment from it and compare.</span>
            <input type="text" value={cpName} onChange={(e) => setCpName(e.target.value)} maxLength={60} autoFocus />
            <Btn kind="primary" onClick={() => void saveCheckpoint()} testid="checkpoint-save">
              Save checkpoint
            </Btn>
          </div>
        </Modal>
      )}
      {dialog === 'branch' && (
        <Modal title="Branch this experiment" onClose={() => setDialog(null)}>
          <div className="col">
            <span className="muted">A branch is a separate copy that starts from a saved moment. Change one thing there and compare it with the original in Compare.</span>
            <Btn kind="primary" onClick={() => void branchFrom(null)} testid="branch-now">
              Branch from right now
            </Btn>
            {checkpoints.map((c) => (
              <Btn key={c.id} onClick={() => void branchFrom(c)}>
                From “{c.label}” ({formatTime(c.tick)})
              </Btn>
            ))}
            {!checkpoints.length && <span className="faint">No checkpoints yet. Use the flag button to save one.</span>}
          </div>
        </Modal>
      )}
      {dialog === 'solved' && chamber && (
        <Modal title="Solved" onClose={() => setDialog(null)} testid="solved">
          <div className="col">
            <span className="display" style={{ fontSize: '1.4em' }}>
              {chamber.title}
            </span>
            <span className="muted">Solved in {formatTime(view.host?.info?.tick ?? 0)} of simulation time.</span>
            <div className="row">
              <Btn kind="primary" onClick={() => void leave('chambers')}>
                Next chamber
              </Btn>
              <Btn onClick={() => setDialog(null)}>Stay and experiment</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export { DISCOVERY_BY_ID }
