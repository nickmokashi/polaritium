import type { AtlasEntry } from '@core/app/atlas'
import type { Command, CommandResult } from '@core/sim/commands'
import type { RenderSnapshot } from '@core/sim/snapshot'
import type { EnvId, Mode, SimEvent } from '@core/sim/types'
import type { FrameInfo, FromWorker, ToWorker } from './protocol'

// The page's handle on a running universe. It paces the simulation to the chosen speed,
// keeps the latest frame for the renderer, and turns worker replies into promises.

export class SimHost {
  private worker: Worker
  private seq = 1
  private waiting = new Map<number, (v: unknown) => void>()
  private inflight = false
  private acc = 0
  private frames = 0
  private dirty = true
  private readyResolve: ((i: FrameInfo) => void) | null = null
  latest: RenderSnapshot | null = null
  info: FrameInfo | null = null
  version = 0
  speed = 1
  paused = false
  /** Measured simulation speed (multiples of normal) over the last second. */
  effective = 1
  private tickWindow: { t: number; ticks: number }[] = []
  wantFields = true
  onEvents: ((e: SimEvent[]) => void) | null = null
  onFindings: ((f: AtlasEntry[]) => void) | null = null
  onInfo: ((i: FrameInfo) => void) | null = null

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data)
  }

  private receive(m: FromWorker): void {
    if (m.t === 'frame') {
      this.inflight = false
      this.latest = m.snap
      this.info = m.info
      this.version++
      const now = performance.now()
      this.tickWindow.push({ t: now, ticks: m.info.ticks })
      while (this.tickWindow.length && now - this.tickWindow[0].t > 1000) this.tickWindow.shift()
      const total = this.tickWindow.reduce((s, x) => s + x.ticks, 0)
      this.effective = total / 30
      if (m.snap.events.length) this.onEvents?.(m.snap.events)
      if (m.findings.length) this.onFindings?.(m.findings)
      this.onInfo?.(m.info)
    } else if (m.t === 'res') {
      const r = this.waiting.get(m.id)
      if (r) {
        this.waiting.delete(m.id)
        r(m.result)
      }
    } else if (m.t === 'ready') {
      this.info = m.info
      this.dirty = true
      this.inflight = false
      this.readyResolve?.(m.info)
      this.readyResolve = null
    }
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m)
  }

  create(opts: { seed: string; env: EnvId; mode: Mode; preset: string; density: number; chamber?: string | null }): Promise<FrameInfo> {
    return new Promise((resolve) => {
      this.readyResolve = resolve
      this.latest = null
      this.send({ t: 'create', ...opts })
    })
  }

  load(state: string): Promise<FrameInfo> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve
      const id = 0
      void id
      this.latest = null
      this.send({ t: 'load', state })
      setTimeout(() => {
        if (this.readyResolve === resolve) {
          this.readyResolve = null
          reject(new Error('The world could not be loaded.'))
        }
      }, 15000)
    })
  }

  setUniverse(id: string | null, name: string | null): void {
    this.send({ t: 'universe', id, name })
  }

  /** Called every animation frame with the seconds elapsed. */
  frame(dt: number): void {
    if (this.inflight) return
    let ticks = 0
    if (!this.paused) {
      this.acc += Math.min(dt, 0.1) * 30 * this.speed
      ticks = Math.floor(this.acc)
      this.acc -= ticks
      ticks = Math.min(ticks, Math.ceil(16 * this.speed))
    }
    if (ticks === 0 && !this.dirty && this.paused) return
    this.dirty = false
    this.inflight = true
    this.frames++
    const fields = this.wantFields && this.frames % 3 === 0
    this.send({ t: 'advance', ticks, fields, budgetMs: 12 })
  }

  /** Advance exactly n ticks (single-step while paused). */
  stepOnce(n = 1): void {
    this.send({ t: 'advance', ticks: n, fields: true, budgetMs: 1000 })
    this.inflight = true
  }

  refresh(): void {
    this.dirty = true
  }

  cmd(cmd: Command, undoable = true): Promise<CommandResult> {
    const id = this.seq++
    this.dirty = true
    return new Promise((resolve) => {
      this.waiting.set(id, resolve as (v: unknown) => void)
      this.send({ t: 'cmd', id, cmd, undoable })
    })
  }

  /** Fire-and-forget command (drags), never undoable on its own. */
  cmdQuiet(cmd: Command): void {
    this.dirty = true
    this.send({ t: 'cmd', id: 0, cmd, undoable: false })
  }

  req<T = unknown>(op: string, args?: unknown): Promise<T> {
    const id = this.seq++
    return new Promise((resolve) => {
      this.waiting.set(id, resolve as (v: unknown) => void)
      this.send({ t: 'req', id, op, args })
    })
  }

  dispose(): void {
    this.worker.terminate()
    this.waiting.clear()
  }
}
