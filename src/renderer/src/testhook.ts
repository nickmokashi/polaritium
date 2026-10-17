import * as THREE from 'three'
import { NODE_STRIDE, STRAND_STRIDE, VEIL_STRIDE } from '@core/sim/snapshot'
import { entityWorld } from './scene/Interaction'
import { view } from './scene/shared'
import { useUI } from './state/store'
import { cam } from './scene/camera'
import { drawStats } from './scene/Scene'

// Only installed when the page is opened with ?test (the headless interface tests). It lets a
// test find where things are on screen so it can click them like a player. The game never
// loads this in normal use.

declare global {
  interface Window {
    __pt?: unknown
  }
}

export function installTestHook(): void {
  window.__pt = {
    project(id: number): { x: number; y: number } | null {
      const p = entityWorld(id)
      const c = view.camera
      const canvas = document.querySelector('canvas')
      if (!p || !c || !canvas) return null
      const v = p.clone().project(c)
      const r = canvas.getBoundingClientRect()
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (1 - (v.y * 0.5 + 0.5)) * r.height }
    },
    projectPoint(x: number, y: number, z: number): { x: number; y: number } | null {
      const c = view.camera
      const canvas = document.querySelector('canvas')
      if (!c || !canvas) return null
      const v = new THREE.Vector3(x, y, z).project(c)
      const r = canvas.getBoundingClientRect()
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (1 - (v.y * 0.5 + 0.5)) * r.height }
    },
    entities() {
      const s = view.snap
      if (!s) return null
      const nodes = Array.from(s.nodeIds, (id, i) => ({ id, kind: s.nodes[i * NODE_STRIDE + 6], x: s.nodes[i * NODE_STRIDE], y: s.nodes[i * NODE_STRIDE + 1], z: s.nodes[i * NODE_STRIDE + 2], freq: s.nodes[i * NODE_STRIDE + 9], flags: s.nodes[i * NODE_STRIDE + 10], fill: s.nodes[i * NODE_STRIDE + 4] }))
      const strands = Array.from(s.strandIds, (id, i) => ({ id, a: s.nodeIds[s.strands[i * STRAND_STRIDE]], b: s.nodeIds[s.strands[i * STRAND_STRIDE + 1]], current: s.strands[i * STRAND_STRIDE + 2], twist: s.strands[i * STRAND_STRIDE + 6], coupling: s.strands[i * STRAND_STRIDE + 8], rest: s.strands[i * STRAND_STRIDE + 14] }))
      return { tick: s.tick, nodes, strands, organisms: s.organismIds.length, rings: s.ringIds.length, veils: s.veils.length / VEIL_STRIDE, crystals: s.crystalIds.length, events: s.events.map((e) => e.type) }
    },
    info: () => view.host?.info ?? null,
    frames: () => drawStats.frames,
    frameMs: () => ({ ms: drawStats.ms, n: drawStats.timed }),
    eventLog: () => [...view.eventLog],
    ui: () => {
      const u = useUI.getState()
      return { screen: u.screen, tool: u.tool, selection: u.selection, sight: u.sight, lens: u.lens, paused: u.paused, speed: u.speed, reading: u.reading, atlas: u.atlas.map((a) => a.id) }
    },
    setPaused(p: boolean) {
      if (view.host) view.host.paused = p
      useUI.getState().set({ paused: p })
    },
    cameraTarget() {
      const t = new THREE.Vector3()
      cam.controls?.getTarget(t)
      return { x: t.x, y: t.y, z: t.z }
    },
    lookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      cam.controls?.setLookAt(px, py, pz, tx, ty, tz, false)
    }
  }
}
