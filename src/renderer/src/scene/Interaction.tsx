import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { CHAMBER_BY_ID, type ToolId } from '@core/sim/chambers'
import { NODE_STRIDE, STRAND_STRIDE } from '@core/sim/snapshot'
import type { Command } from '@core/sim/commands'
import { audio } from '../audio/engine'
import { useUI } from '../state/store'
import { cam, driveCamera, focusOn, goBack } from './camera'
import { pick, pointOnViewPlane, type Pick } from './picking'
import { view } from './shared'

// Every god power, in the space itself. The left button uses the current tool; the right
// button orbits; the middle button (or Shift + right) pans; the wheel zooms. Every tool also
// works by keyboard: select, then use the arrow keys and + / - (see the Help panel).

export const TOOL_KEYS: Record<string, ToolId> = {
  '1': 'hand',
  '2': 'seed',
  '3': 'strand',
  '4': 'pull',
  '5': 'twist',
  '6': 'pulse',
  '7': 'tune',
  '8': 'fracture',
  '9': 'fuse',
  '0': 'veil',
  l: 'lens',
  k: 'anchor'
}

/** Shared with the preview overlay. */
export const ix = {
  line: null as null | { a: THREE.Vector3; b: THREE.Vector3 },
  sphere: null as null | { c: THREE.Vector3; r: number },
  charge: 0,
  ghost: null as null | THREE.Vector3,
  pullPoint: null as null | THREE.Vector3,
  pullStrength: 1.6
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'orbit'; x: number; y: number }
  | { kind: 'grab'; id: number; plane: THREE.Vector3; last: THREE.Vector3; lastT: number; vel: THREE.Vector3; moved: number }
  | { kind: 'strand'; from: number; fromPos: THREE.Vector3 }
  | { kind: 'rest'; id: number; start: number; y: number }
  | { kind: 'twist'; id: number; start: number; x: number }
  | { kind: 'coupling'; id: number; start: number; x: number; resistance: boolean }
  | { kind: 'freq'; id: number; start: number; x: number }
  | { kind: 'pull'; strength: number }
  | { kind: 'pulse'; at: THREE.Vector3; t0: number }
  | { kind: 'veil'; c: THREE.Vector3 }

export function allowedTools(): ToolId[] | null {
  const spec = useUI.getState().spec
  if (!spec?.chamber) return null
  return CHAMBER_BY_ID.get(spec.chamber)?.tools ?? null
}

export async function selectEntity(id: number | null, add = false): Promise<void> {
  const ui = useUI.getState()
  const sel = id === null ? [] : add ? (ui.selection.includes(id) ? ui.selection.filter((x) => x !== id) : [...ui.selection, id]) : [id]
  view.selected = new Set(sel)
  ui.set({ selection: sel })
  if (!sel.length) {
    ui.set({ reading: null })
    return
  }
  const r = await view.host?.req('inspect', { id: sel[sel.length - 1] })
  useUI.getState().set({ reading: (r as never) ?? null })
}

async function run(cmd: Command, undoable = true): Promise<boolean> {
  const r = await view.host?.cmd(cmd, undoable)
  if (r && !r.ok && r.error) {
    useUI.getState().toast(r.error, 'warn')
    audio.ui('error')
    return false
  }
  return !!r?.ok
}

function snapNodeIndex(id: number): number {
  return view.nodeIndex.get(id) ?? -1
}

function nodeWorld(id: number): THREE.Vector3 | null {
  const i = snapNodeIndex(id)
  if (i < 0) return null
  return new THREE.Vector3(view.nodePos[i * 3], view.nodePos[i * 3 + 1], view.nodePos[i * 3 + 2])
}

export function entityWorld(id: number): THREE.Vector3 | null {
  const n = nodeWorld(id)
  if (n) return n
  const oi = view.orgIndex.get(id)
  if (oi !== undefined) return new THREE.Vector3(view.orgPos[oi * 3], view.orgPos[oi * 3 + 1], view.orgPos[oi * 3 + 2])
  const s = view.snap
  if (!s) return null
  const si = view.strandIndex.get(id)
  if (si !== undefined) {
    const a = s.strands[si * STRAND_STRIDE]
    const b = s.strands[si * STRAND_STRIDE + 1]
    if (a >= 0 && b >= 0) return new THREE.Vector3((view.nodePos[a * 3] + view.nodePos[b * 3]) / 2, (view.nodePos[a * 3 + 1] + view.nodePos[b * 3 + 1]) / 2, (view.nodePos[a * 3 + 2] + view.nodePos[b * 3 + 2]) / 2)
  }
  const ri = Array.from(s.ringIds).indexOf(id)
  if (ri >= 0) return new THREE.Vector3(s.rings[ri * 14], s.rings[ri * 14 + 1], s.rings[ri * 14 + 2])
  for (let i = 0; i < s.segCrystal.length; i++) if (s.segCrystal[i] === id) return new THREE.Vector3(s.segs[i * 10], s.segs[i * 10 + 1], s.segs[i * 10 + 2])
  return null
}

export function Interaction() {
  const { camera, gl, size } = useThree()
  const keys = useMemo(() => new Set<string>(), [])

  useEffect(() => {
    const dom = gl.domElement
    let g: Gesture = { kind: 'none' }
    let downAt = { x: 0, y: 0, t: 0 }
    let fusePending: number | null = null
    let lastHover = 0
    const ndcOf = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect()
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const doPick = (e: PointerEvent): Pick | null => {
      const s = view.snap
      if (!s) return null
      const r = dom.getBoundingClientRect()
      return pick(s, view.nodePos, view.orgPos, camera, ndcOf(e), { w: r.width, h: r.height })
    }
    const target = () => {
      const t = new THREE.Vector3()
      cam.controls?.getTarget(t)
      return t
    }
    const toolOk = (t: ToolId) => {
      const allowed = allowedTools()
      return !allowed || allowed.includes(t)
    }

    const onDown = (e: PointerEvent) => {
      audio.start()
      const ui = useUI.getState()
      if (e.button === 2 && e.shiftKey && cam.controls) cam.controls.mouseButtons.right = 2 // TRUCK
      if (e.button !== 0) return
      dom.setPointerCapture(e.pointerId)
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
      const p = doPick(e)
      const tool = ui.tool
      const s = view.snap
      switch (tool) {
        case 'hand': {
          if (p && (p.type === 'node' || p.type === 'organism')) {
            void selectEntity(p.id, e.shiftKey)
            g = { kind: 'grab', id: p.id, plane: p.point.clone(), last: p.point.clone(), lastT: performance.now(), vel: new THREE.Vector3(), moved: 0 }
            void run({ type: 'grab', id: p.id }, true)
          } else if (p) {
            void selectEntity(p.id, e.shiftKey)
            if (p.type === 'strand' && s) {
              const si = view.strandIndex.get(p.id)!
              audio.pluck(s.strands[si * STRAND_STRIDE + 3] * 12, s.strands[si * STRAND_STRIDE + 14])
            }
            g = { kind: 'orbit', x: e.clientX, y: e.clientY }
          } else {
            if (!e.shiftKey) void selectEntity(null)
            g = { kind: 'orbit', x: e.clientX, y: e.clientY }
          }
          break
        }
        case 'seed': {
          const at = p?.type === 'node' ? p.point.clone().add(new THREE.Vector3(0, 3, 0)) : pointOnViewPlane(camera, ndcOf(e), target())
          const k = ui.seedKind
          const cmd: Command =
            k === 'crystal' ? { type: 'seedCrystal', p: at } : k === 'life' ? { type: 'seedSpore', p: at, archetype: ui.sporeType } : { type: 'seed', kind: k, p: at, mass: ui.seedMass }
          void run(cmd).then((ok) => ok && audio.ui('click'))
          break
        }
        case 'strand': {
          if (p?.type === 'node') {
            if (ui.pendingStrand !== null && ui.pendingStrand !== p.id) {
              const from = ui.pendingStrand
              ui.set({ pendingStrand: null })
              ix.line = null
              void run({ type: 'connect', a: from, b: p.id })
            } else g = { kind: 'strand', from: p.id, fromPos: p.point.clone() }
          } else {
            ui.set({ pendingStrand: null })
            ix.line = null
            if (p) ui.toast('Strands connect light, dark and grey concentrations.', 'info')
          }
          break
        }
        case 'pull': {
          if (p?.type === 'strand' && s) {
            const si = view.strandIndex.get(p.id)!
            const rest = s.strands[si * STRAND_STRIDE + 14]
            void selectEntity(p.id)
            void run({ type: 'setStrand', id: p.id, rest }, true)
            g = { kind: 'rest', id: p.id, start: rest, y: e.clientY }
          } else {
            g = { kind: 'pull', strength: e.shiftKey || e.altKey ? -1.6 : 1.6 }
            ix.pullPoint = p ? p.point.clone() : pointOnViewPlane(camera, ndcOf(e), target())
            ix.pullStrength = g.strength
            void run({ type: 'pull', p: ix.pullPoint, strength: g.strength, r: 18, ticks: 2 }, true)
          }
          break
        }
        case 'twist': {
          if (p?.type === 'strand' && s) {
            const si = view.strandIndex.get(p.id)!
            void selectEntity(p.id)
            const start = s.strands[si * STRAND_STRIDE + 6]
            void run({ type: 'setStrand', id: p.id, twist: start }, true)
            g = { kind: 'twist', id: p.id, start, x: e.clientX }
          } else ui.toast('Twist turns a strand. Choose a strand and drag sideways.', 'info')
          break
        }
        case 'pulse': {
          const at = p ? p.point.clone() : pointOnViewPlane(camera, ndcOf(e), target())
          g = { kind: 'pulse', at, t0: performance.now() }
          break
        }
        case 'tune': {
          if (p?.type === 'strand' && s) {
            const si = view.strandIndex.get(p.id)!
            void selectEntity(p.id)
            const res = e.altKey
            const start = res ? s.strands[si * STRAND_STRIDE + 12] : s.strands[si * STRAND_STRIDE + 8]
            void run({ type: 'setStrand', id: p.id, ...(res ? { resistance: start } : { coupling: start }) }, true)
            g = { kind: 'coupling', id: p.id, start, x: e.clientX, resistance: res }
          } else if (p?.type === 'node' && s) {
            const ni = snapNodeIndex(p.id)
            void selectEntity(p.id)
            const start = s.nodes[ni * NODE_STRIDE + 9]
            void run({ type: 'tune', id: p.id, freq: start }, true)
            g = { kind: 'freq', id: p.id, start, x: e.clientX }
            audio.tune(start)
          } else if (p?.type === 'crystal') {
            void selectEntity(p.id)
            const id = p.id
            const x = e.clientX
            void view.host?.req<{ facts: { freq: number } } | null>('inspect', { id }).then((r) => {
              if (!r) return
              void run({ type: 'tune', id, freq: r.facts.freq }, true)
              g = { kind: 'freq', id, start: r.facts.freq, x }
              audio.tune(r.facts.freq)
            })
          } else ui.toast('Tune changes a rhythm (on light, dark, grey or crystal) or a strand’s coupling. Hold Alt for resistance.', 'info')
          break
        }
        case 'fracture': {
          if (!p) break
          if (p.type === 'strand') void run({ type: 'cut', id: p.id })
          else if (p.type === 'veil') void run({ type: 'unveil', id: p.id })
          else void run({ type: 'destabilize', id: p.id, amount: e.shiftKey ? 2 : 1 })
          break
        }
        case 'fuse': {
          if (!p || p.type === 'strand' || p.type === 'crystal' || p.type === 'veil') {
            fusePending = null
            ui.toast('Fuse joins two concentrations, two rings, or two related living forms. Choose the first.', 'info')
            break
          }
          if (fusePending === null || fusePending === p.id) {
            fusePending = p.id
            void selectEntity(p.id)
            ui.toast('Now choose what to fuse it with.', 'info')
          } else {
            const a = fusePending
            fusePending = null
            void run({ type: 'fuse', a, b: p.id }).then(() => selectEntity(a))
          }
          break
        }
        case 'veil': {
          if (p?.type === 'veil') {
            void run({ type: 'unveil', id: p.id })
            break
          }
          const c = p ? p.point.clone() : pointOnViewPlane(camera, ndcOf(e), target())
          g = { kind: 'veil', c }
          ix.sphere = { c, r: ui.veilRadius }
          break
        }
        case 'lens': {
          if (p) void selectEntity(p.id, e.shiftKey)
          g = { kind: 'orbit', x: e.clientX, y: e.clientY }
          break
        }
        case 'anchor': {
          if (!p || p.type === 'crystal' || p.type === 'ring' || p.type === 'veil') {
            ui.toast('Anchor holds light, dark, grey, strands or living forms in place.', 'info')
            break
          }
          let anchored = false
          if (p.type === 'node' && s) anchored = (s.nodes[snapNodeIndex(p.id) * NODE_STRIDE + 10] & 4) !== 0
          void run({ type: 'anchor', id: p.id, flags: anchored ? 0 : ui.anchorFlags }).then((ok) => ok && ui.toast(anchored ? 'Released.' : 'Anchored.', 'info'))
          void selectEntity(p.id)
          break
        }
      }
    }

    const onMove = (e: PointerEvent) => {
      const now = performance.now()
      if (g.kind === 'none' && now - lastHover > 60) {
        lastHover = now
        const p = doPick(e)
        const id = p?.id ?? null
        if (id !== view.hover) {
          view.hover = id
          useUI.getState().set({ hover: id })
        }
        const ui = useUI.getState()
        if (ui.tool === 'seed') ix.ghost = pointOnViewPlane(camera, ndcOf(e), target())
        else ix.ghost = null
        if (ui.pendingStrand !== null) {
          const a = nodeWorld(ui.pendingStrand)
          ix.line = a ? { a, b: p?.point ?? pointOnViewPlane(camera, ndcOf(e), a) } : null
        }
      }
      switch (g.kind) {
        case 'orbit': {
          const dx = e.clientX - g.x
          const dy = e.clientY - g.y
          g.x = e.clientX
          g.y = e.clientY
          cam.controls?.rotate((-dx * 0.006 * cam.orbitSpeed), (-dy * 0.006 * cam.orbitSpeed) * (cam.invertY ? -1 : 1), true)
          break
        }
        case 'grab': {
          const w = pointOnViewPlane(camera, ndcOf(e), g.plane)
          const dt = Math.max(1, now - g.lastT) / 1000
          const v = w.clone().sub(g.last).divideScalar(dt)
          g.vel.lerp(v, 0.35)
          g.moved += w.distanceTo(g.last)
          g.last = w
          g.lastT = now
          view.host?.cmdQuiet({ type: 'drag', id: g.id, p: w })
          break
        }
        case 'strand': {
          const p = doPick(e)
          ix.line = { a: g.fromPos, b: p?.type === 'node' ? p.point : pointOnViewPlane(camera, ndcOf(e), g.fromPos) }
          break
        }
        case 'rest': {
          const rest = Math.max(1.5, g.start * Math.exp((e.clientY - g.y) * 0.008))
          view.host?.cmdQuiet({ type: 'setStrand', id: g.id, rest })
          break
        }
        case 'twist': {
          const twist = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, g.start + (e.clientX - g.x) * 0.015))
          view.host?.cmdQuiet({ type: 'setStrand', id: g.id, twist })
          break
        }
        case 'coupling': {
          const v = g.resistance ? Math.max(0.05, Math.min(6, g.start * Math.exp((e.clientX - g.x) * 0.006))) : Math.max(0, Math.min(2.5, g.start + (e.clientX - g.x) * 0.004))
          view.host?.cmdQuiet({ type: 'setStrand', id: g.id, ...(g.resistance ? { resistance: v } : { coupling: v }) })
          break
        }
        case 'freq': {
          const f = Math.max(0.05, Math.min(2.5, g.start * Math.exp((e.clientX - g.x) * 0.005)))
          view.host?.cmdQuiet({ type: 'tune', id: g.id, freq: f })
          audio.tune(f)
          break
        }
        case 'pull': {
          ix.pullPoint = pointOnViewPlane(camera, ndcOf(e), ix.pullPoint ?? target())
          break
        }
        case 'veil': {
          const w = pointOnViewPlane(camera, ndcOf(e), g.c)
          const r = Math.max(3, Math.min(30, w.distanceTo(g.c)))
          ix.sphere = { c: g.c, r: Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 ? useUI.getState().veilRadius : r }
          break
        }
      }
    }

    const finish = (e: PointerEvent) => {
      if (cam.controls) cam.controls.mouseButtons.right = 1 // ROTATE
      if (e.button !== 0) return
      const ui = useUI.getState()
      switch (g.kind) {
        case 'grab': {
          const v = g.vel.clone().multiplyScalar(g.moved > 0.5 ? 0.8 : 0)
          view.host?.cmdQuiet({ type: 'release', id: g.id, v: { x: v.x, y: v.y, z: v.z } })
          break
        }
        case 'strand': {
          const p = doPick(e)
          if (p?.type === 'node' && p.id !== g.from) {
            ix.line = null
            void run({ type: 'connect', a: g.from, b: p.id })
          } else {
            ui.set({ pendingStrand: g.from })
            ui.toast('Now choose where the strand should go.', 'info')
          }
          break
        }
        case 'freq':
          audio.tune(null)
          void selectEntity(g.id)
          break
        case 'rest':
        case 'twist':
        case 'coupling':
          void selectEntity(g.id)
          break
        case 'pulse': {
          const held = (performance.now() - g.t0) / 1000
          const strength = Math.min(12, ui.pulseStrength * (0.5 + Math.min(1.5, held)))
          ix.charge = 0
          void run({ type: 'pulse', p: g.at, strength, radius: 3 + strength * 0.6 })
          break
        }
        case 'pull':
          ix.pullPoint = null
          break
        case 'veil': {
          const r = ix.sphere?.r ?? ui.veilRadius
          ix.sphere = null
          void run({ type: 'veil', p: g.c, r, ticks: ui.veilSeconds * 30, mask: ui.veilMask })
          break
        }
      }
      g = { kind: 'none' }
    }

    const typing = () => {
      const a = document.activeElement
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement
    }

    const onKey = (e: KeyboardEvent) => {
      if (typing()) return
      const ui = useUI.getState()
      if (ui.screen !== 'game' && ui.screen !== 'exhibit') return
      const k = e.key.toLowerCase()
      keys.add(k === 'shift' ? 'shift' : k)
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) void undoRedo('undo')
        else if (k === 'y' || (k === 'z' && e.shiftKey)) void undoRedo('redo')
        else if (k === 's') window.dispatchEvent(new CustomEvent('polaritium:save'))
        e.preventDefault()
        return
      }
      if (TOOL_KEYS[k] && !e.altKey) {
        const t = TOOL_KEYS[k]
        if (t === 'lens') {
          view.lens = !ui.lens
          ui.set({ lens: !ui.lens })
          return
        }
        if (!toolOk(t)) {
          ui.toast('That tool is not part of this chamber.', 'warn')
          return
        }
        ui.set({ tool: t, pendingStrand: null })
        ix.line = null
        audio.ui('click')
        return
      }
      const sel = ui.selection[ui.selection.length - 1]
      switch (k) {
        case 'tab':
          e.preventDefault()
          view.sight = !ui.sight
          ui.set({ sight: !ui.sight })
          break
        case ' ':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('polaritium:pause'))
          break
        case '.':
          window.dispatchEvent(new CustomEvent('polaritium:step'))
          break
        case '[':
          window.dispatchEvent(new CustomEvent('polaritium:speed', { detail: -1 }))
          break
        case ']':
          window.dispatchEvent(new CustomEvent('polaritium:speed', { detail: 1 }))
          break
        case 'f': {
          if (sel !== undefined) {
            const p = entityWorld(sel)
            if (p) focusOn(p, 2)
          }
          break
        }
        case 'g':
          cam.follow = cam.follow === null && sel !== undefined ? sel : null
          ui.toast(cam.follow !== null ? 'Following. Press G again to stop.' : 'Stopped following.', 'info')
          break
        case 'backspace':
          if (!goBack()) ui.toast('No earlier view to return to.', 'info')
          break
        case 'c':
          cam.cinematic = !cam.cinematic
          ui.toast(cam.cinematic ? 'Cinematic camera on. Press C to stop.' : 'Cinematic camera off.', 'info')
          break
        case 'h':
        case '?':
          ui.set({ helpOpen: !ui.helpOpen })
          break
        case 'p':
          window.dispatchEvent(new CustomEvent('polaritium:photo'))
          break
        case 'escape':
          if (ui.pendingStrand !== null) {
            ui.set({ pendingStrand: null })
            ix.line = null
          } else if (ui.selection.length) void selectEntity(null)
          else window.dispatchEvent(new CustomEvent('polaritium:menu'))
          break
        case 'delete':
          if (sel !== undefined) void run(ui.spec?.mode === 'lab' ? { type: 'remove', id: sel } : { type: 'destabilize', id: sel }).then(() => selectEntity(null))
          break
        case 'arrowleft':
        case 'arrowright':
        case 'arrowup':
        case 'arrowdown': {
          if (sel === undefined) break
          e.preventDefault()
          const right = new THREE.Vector3()
          const up = new THREE.Vector3(0, 1, 0)
          const fwd = new THREE.Vector3()
          camera.getWorldDirection(fwd)
          right.crossVectors(fwd, up).normalize()
          const step = e.shiftKey ? 0.3 : 1.2
          const d = k === 'arrowleft' ? right.multiplyScalar(-step) : k === 'arrowright' ? right.multiplyScalar(step) : e.altKey ? fwd.multiplyScalar(k === 'arrowup' ? step : -step) : up.multiplyScalar(k === 'arrowup' ? step : -step)
          void run({ type: 'nudge', id: sel, d: { x: d.x, y: d.y, z: d.z } }, false)
          break
        }
        case '=':
        case '+':
        case '-':
        case '_':
          if (sel !== undefined) void adjustSelected(sel, k === '=' || k === '+' ? 1 : -1, e.altKey)
          break
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      keys.delete(k === 'shift' ? 'shift' : k)
    }
    const onBlur = () => keys.clear()

    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerup', finish)
    dom.addEventListener('pointercancel', finish)
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerup', finish)
      dom.removeEventListener('pointercancel', finish)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [camera, gl, size, keys])

  useFrame((_, dt) => {
    const ui = useUI.getState()
    const follow = cam.follow !== null ? entityWorld(cam.follow) : null
    if (cam.follow !== null && !follow) cam.follow = null
    driveCamera(dt, keys, follow, ui.settings.access.reduceMotion)
    if (ix.pullPoint) view.host?.cmdQuiet({ type: 'pull', p: ix.pullPoint, strength: ix.pullStrength, r: 18, ticks: 3 })
  })

  return null
}

export async function undoRedo(op: 'undo' | 'redo'): Promise<void> {
  const r = await view.host?.req<{ ok: boolean; tick?: number }>(op)
  const ui = useUI.getState()
  if (r?.ok) {
    ui.toast(op === 'undo' ? `Restored the exact state before your last action (tick ${r.tick}).` : 'Redone.', 'info')
    view.host?.refresh()
    if (ui.selection.length) void selectEntity(ui.selection[ui.selection.length - 1])
  } else ui.toast(op === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.', 'info')
}

/** Keyboard and panel alternative to dragging: + / - adjust the selected thing for the current tool. */
export async function adjustSelected(id: number, dir: 1 | -1, alt = false): Promise<void> {
  const s = view.snap
  const ui = useUI.getState()
  if (!s) return
  const si = view.strandIndex.get(id)
  const ni = view.nodeIndex.get(id)
  if (si !== undefined) {
    const o = si * STRAND_STRIDE
    if (ui.tool === 'twist') await run({ type: 'setStrand', id, twist: s.strands[o + 6] + dir * (Math.PI / 12) })
    else if (ui.tool === 'pull') await run({ type: 'setStrand', id, rest: Math.max(1.5, s.strands[o + 14] * (dir > 0 ? 1.1 : 0.9)) })
    else if (alt) await run({ type: 'setStrand', id, resistance: Math.max(0.05, s.strands[o + 12] * (dir > 0 ? 1.15 : 0.87)) })
    else await run({ type: 'setStrand', id, coupling: Math.max(0, Math.min(2.5, s.strands[o + 8] + dir * 0.05)) })
  } else if (ni !== undefined) {
    const f = s.nodes[ni * NODE_STRIDE + 9] * (dir > 0 ? 1.06 : 1 / 1.06)
    await run({ type: 'tune', id, freq: f })
    audio.tune(f)
    setTimeout(() => audio.tune(null), 350)
  } else {
    const r = await view.host?.req<{ facts: { freq?: number } } | null>('inspect', { id })
    if (r?.facts.freq !== undefined) await run({ type: 'tune', id, freq: r.facts.freq * (dir > 0 ? 1.06 : 1 / 1.06) })
  }
  await selectEntity(id)
}
