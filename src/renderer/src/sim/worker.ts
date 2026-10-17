/// <reference lib="webworker" />
import { entryFromFinding, type AtlasEntry } from '@core/app/atlas'
import { createChamberWorld } from '@core/sim/chambers'
import { applyCommand } from '@core/sim/commands'
import { inspect, inspectPoint, summarize } from '@core/sim/inspect'
import { applyPreset } from '@core/sim/presets'
import { deserializeWorld, serializeWorld, stateHash } from '@core/sim/serialize'
import { buildSnapshot, snapshotTransferables } from '@core/sim/snapshot'
import { step } from '@core/sim/step'
import type { SimEvent, WorldState } from '@core/sim/types'
import { createWorld } from '@core/sim/world'
import type { FrameInfo, FromWorker, ToWorker } from './protocol'

// The universe lives here, off the main thread. The page sends actions and asks for frames;
// this worker steps the simulation within a time budget and posts back what to draw.

const ctx = self as unknown as DedicatedWorkerGlobalScope
let w: WorldState | null = null
let universe: { id: string | null; name: string | null } = { id: null, name: null }
let undo: string[] = []
let redo: string[] = []
let autos: { tick: number; data: string }[] = []
let pendingEvents: SimEvent[] = []
let pendingFindings: AtlasEntry[] = []
let lastMs = 0

const UNDO_MAX = 25
const AUTO_EVERY = 300
const AUTO_MAX = 40

function info(ticks = 0): FrameInfo {
  return {
    tick: w?.tick ?? 0,
    ticks,
    ms: lastMs,
    chamber: w?.chamber ? { ...w.chamber, memo: { ...w.chamber.memo } } : null,
    laws: w ? { ...w.laws } : { phase: true, mediators: true, crystals: true, membranes: true, life: true, adaptation: true },
    env: w?.env ?? 'cradle',
    mode: w?.mode ?? 'lab',
    found: w ? Object.keys(w.found) : [],
    canUndo: undo.length > 0,
    canRedo: redo.length > 0
  }
}

function collect(): void {
  if (!w) return
  for (const e of w.events) {
    if (pendingEvents.length < 600) pendingEvents.push(e)
    if (e.type === 'finding') {
      const entry = entryFromFinding(w, e, universe)
      if (entry) pendingFindings.push(entry)
    }
  }
  w.events = []
}

function reset(next: WorldState): void {
  w = next
  undo = []
  redo = []
  autos = [{ tick: w.tick, data: serializeWorld(w) }]
  pendingEvents = []
  pendingFindings = []
}

function post(m: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(m, transfer)
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  try {
    switch (m.t) {
      case 'create': {
        let next: WorldState
        if (m.chamber) next = createChamberWorld(m.chamber, m.seed)
        else {
          next = createWorld({ seed: m.seed, env: m.env, mode: m.mode })
          applyPreset(next, m.preset, m.density)
        }
        reset(next)
        post({ t: 'ready', info: info() })
        break
      }
      case 'load': {
        reset(deserializeWorld(m.state))
        post({ t: 'ready', info: info() })
        break
      }
      case 'universe':
        universe = { id: m.id, name: m.name }
        break
      case 'advance': {
        if (!w) return
        const t0 = performance.now()
        let done = 0
        for (; done < m.ticks; done++) {
          step(w)
          collect()
          if (w.tick % AUTO_EVERY === 0) {
            autos.push({ tick: w.tick, data: serializeWorld(w) })
            if (autos.length > AUTO_MAX) autos.shift()
          }
          if (performance.now() - t0 > m.budgetMs) {
            done++
            break
          }
        }
        lastMs = performance.now() - t0
        const snap = buildSnapshot(w, { fields: m.fields, events: pendingEvents })
        const findings = pendingFindings
        pendingEvents = []
        pendingFindings = []
        post({ t: 'frame', snap, info: info(done), findings }, snapshotTransferables(snap))
        break
      }
      case 'cmd': {
        if (!w) return post({ t: 'res', id: m.id, result: { ok: false, error: 'No universe is running.' } })
        const before = m.undoable ? serializeWorld(w) : null
        const r = applyCommand(w, m.cmd)
        if (r.ok && before) {
          undo.push(before)
          if (undo.length > UNDO_MAX) undo.shift()
          redo = []
        }
        collect()
        post({ t: 'res', id: m.id, result: r })
        break
      }
      case 'req': {
        if (!w) return post({ t: 'res', id: m.id, result: null })
        const a = (m.args ?? {}) as Record<string, any>
        let result: unknown = null
        switch (m.op) {
          case 'inspect':
            result = inspect(w, a.id)
            break
          case 'inspectPoint':
            result = inspectPoint(w, a.p)
            break
          case 'summary':
            result = summarize(w)
            break
          case 'serialize':
            result = serializeWorld(w)
            break
          case 'hash':
            result = stateHash(w)
            break
          case 'undo':
            if (undo.length) {
              redo.push(serializeWorld(w))
              w = deserializeWorld(undo.pop()!)
              result = { ok: true, tick: w.tick }
            } else result = { ok: false }
            break
          case 'redo':
            if (redo.length) {
              undo.push(serializeWorld(w))
              w = deserializeWorld(redo.pop()!)
              result = { ok: true, tick: w.tick }
            } else result = { ok: false }
            break
          case 'autos':
            result = autos.map((x, i) => ({ index: i, tick: x.tick }))
            break
          case 'rewind': {
            const target = autos[a.index]
            if (target) {
              undo.push(serializeWorld(w))
              w = deserializeWorld(target.data)
              autos = autos.slice(0, a.index + 1)
              result = { ok: true, tick: w.tick }
            } else result = { ok: false }
            break
          }
          case 'restartChamber': {
            if (w.chamber) reset(createChamberWorld(w.chamber.id, a.seed ?? 'chamber'))
            result = { ok: true }
            break
          }
          case 'entityAt': {
            result = null
            break
          }
          default:
            result = null
        }
        post({ t: 'res', id: m.id, result })
        break
      }
    }
  } catch (e) {
    if ('id' in m) post({ t: 'res', id: (m as { id: number }).id, result: null, error: (e as Error).message })
    else post({ t: 'res', id: -1, result: null, error: (e as Error).message })
  }
}
