import { createContext, useContext } from 'react'
import * as THREE from 'three'
import type { RenderSnapshot } from '@core/sim/snapshot'
import { NODE_STRIDE, ORG_STRIDE } from '@core/sim/snapshot'
import type { SimHost } from '../sim/host'

// State shared by every layer of the scene, updated once per frame by the Updater before any
// layer draws. Displayed positions are eased toward the simulation's so motion stays smooth
// between simulation ticks; the simulation's own numbers are never changed by this.

export const uniforms = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0x050506) },
  uFogDensity: { value: 0.01 },
  uSight: { value: 0 },
  uLens: { value: 0 },
  uFlashLimit: { value: 1 }
}

function viewUniforms() {
  return {
    uLights: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    uLightCount: { value: 0 },
    uPlane: { value: 0 },
    uRadius: { value: 60 },
    uFieldHalf: { value: 63 },
    uRadiance: { value: null as THREE.Data3DTexture | null },
    uSignal: { value: null as THREE.Data3DTexture | null }
  }
}

export class ViewState {
  host: SimHost | null = null
  snap: RenderSnapshot | null = null
  version = -1
  /** Eased positions, aligned with the snapshot's node and organism order. */
  nodePos = new Float32Array(0)
  orgPos = new Float32Array(0)
  nodeIndex = new Map<number, number>()
  strandIndex = new Map<number, number>()
  orgIndex = new Map<number, number>()
  selected = new Set<number>()
  hover: number | null = null
  sight = false
  lens = false
  reduceMotion = false
  reduceFlashing = false
  dustCount = 6000
  easedNodes = new Map<number, THREE.Vector3>()
  easedOrgs = new Map<number, THREE.Vector3>()
  u = viewUniforms()
}

/** The main game's view. Compare creates its own. */
export const view = new ViewState()
export const ViewContext = createContext<ViewState>(view)
export const useView = () => useContext(ViewContext)

function ease(map: Map<number, THREE.Vector3>, id: number, x: number, y: number, z: number, k: number): THREE.Vector3 {
  let v = map.get(id)
  if (!v) {
    v = new THREE.Vector3(x, y, z)
    map.set(id, v)
    return v
  }
  if ((v.x - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2 > 400) v.set(x, y, z)
  else {
    v.x += (x - v.x) * k
    v.y += (y - v.y) * k
    v.z += (z - v.z) * k
  }
  return v
}

/** Called once per frame. Returns true when a new snapshot arrived. */
export function updateView(view: ViewState, dt: number): boolean {
  const h = view.host
  if (!h) return false
  const s = h.latest
  const fresh = !!s && h.version !== view.version
  if (s && fresh) {
    view.snap = s
    view.version = h.version
    view.nodeIndex.clear()
    s.nodeIds.forEach((id, i) => view.nodeIndex.set(id, i))
    view.strandIndex.clear()
    s.strandIds.forEach((id, i) => view.strandIndex.set(id, i))
    view.orgIndex.clear()
    s.organismIds.forEach((id, i) => view.orgIndex.set(id, i))
    // forget eased positions of things that no longer exist
    if (view.easedNodes.size > s.nodeIds.length * 2 + 50) for (const id of [...view.easedNodes.keys()]) if (!view.nodeIndex.has(id)) view.easedNodes.delete(id)
    if (view.easedOrgs.size > s.organismIds.length * 2 + 50) for (const id of [...view.easedOrgs.keys()]) if (!view.orgIndex.has(id)) view.easedOrgs.delete(id)
  }
  const snap = view.snap
  if (!snap) return fresh
  const k = 1 - Math.exp(-dt * 18)
  const n = snap.nodeIds.length
  if (view.nodePos.length !== n * 3) view.nodePos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const o = i * NODE_STRIDE
    const v = ease(view.easedNodes, snap.nodeIds[i], snap.nodes[o], snap.nodes[o + 1], snap.nodes[o + 2], k)
    view.nodePos[i * 3] = v.x
    view.nodePos[i * 3 + 1] = v.y
    view.nodePos[i * 3 + 2] = v.z
  }
  const m = snap.organismIds.length
  if (view.orgPos.length !== m * 3) view.orgPos = new Float32Array(m * 3)
  for (let i = 0; i < m; i++) {
    const o = i * ORG_STRIDE
    const v = ease(view.easedOrgs, snap.organismIds[i], snap.organisms[o], snap.organisms[o + 1], snap.organisms[o + 2], k)
    view.orgPos[i * 3] = v.x
    view.orgPos[i * 3 + 1] = v.y
    view.orgPos[i * 3 + 2] = v.z
  }
  // The brightest emitters light the scene.
  const lights: { i: number; w: number }[] = []
  for (let i = 0; i < n; i++) {
    const o = i * NODE_STRIDE
    if (snap.nodes[o + 6] === 1) lights.push({ i, w: (0.4 + snap.nodes[o + 4] * 1.6) * Math.sqrt(snap.nodes[o + 12]) * (1 + snap.nodes[o + 8]) })
  }
  lights.sort((a, b) => b.w - a.w)
  const L = view.u.uLights.value
  const count = Math.min(6, lights.length)
  for (let j = 0; j < count; j++) {
    const i = lights[j].i
    L[j].set(view.nodePos[i * 3], view.nodePos[i * 3 + 1], view.nodePos[i * 3 + 2], lights[j].w * 1.6)
  }
  view.u.uLightCount.value = count
  view.u.uPlane.value = snap.plane
  return fresh
}

export function resetView(view: ViewState = globalView): void {
  view.easedNodes.clear()
  view.easedOrgs.clear()
  view.snap = null
  view.version = -1
  view.nodePos = new Float32Array(0)
  view.orgPos = new Float32Array(0)
  view.selected.clear()
  view.hover = null
}

const globalView = view
