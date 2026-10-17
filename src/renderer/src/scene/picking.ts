import * as THREE from 'three'
import type { RenderSnapshot } from '@core/sim/snapshot'
import { NODE_STRIDE, ORG_STRIDE, RING_STRIDE, SEG_STRIDE, STRAND_STRIDE, VEIL_STRIDE } from '@core/sim/snapshot'

// What is under the pointer. Spheres (nodes, organisms, veils) are hit by the ray; thin things
// (strands, crystal facets, ring halos) are hit within a few pixels on screen, which is what a
// hand actually aims at. Pure functions of the snapshot, the eased positions and the camera.

export type PickType = 'node' | 'organism' | 'strand' | 'crystal' | 'ring' | 'veil'

export interface Pick {
  type: PickType
  id: number
  point: THREE.Vector3
  depth: number
}

const tmp = new THREE.Vector3()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()

export function raySphere(ray: THREE.Ray, c: THREE.Vector3, r: number): number | null {
  const oc = tmp.copy(ray.origin).sub(c)
  const b = oc.dot(ray.direction)
  const cc = oc.lengthSq() - r * r
  const disc = b * b - cc
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t > 0 ? t : null
}

function toScreen(p: THREE.Vector3, camera: THREE.Camera, w: number, h: number, out: THREE.Vector3): boolean {
  out.copy(p).project(camera)
  if (out.z < -1 || out.z > 1) return false
  out.x = (out.x * 0.5 + 0.5) * w
  out.y = (1 - (out.y * 0.5 + 0.5)) * h
  return true
}

export function segScreenDistance(px: number, py: number, a: THREE.Vector3, b: THREE.Vector3): { d: number; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1e-6
  let t = ((px - a.x) * dx + (py - a.y) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const x = a.x + dx * t
  const y = a.y + dy * t
  return { d: Math.hypot(px - x, py - y), t }
}

export function pick(
  snap: RenderSnapshot,
  nodePos: Float32Array,
  orgPos: Float32Array,
  camera: THREE.Camera,
  ndc: THREE.Vector2,
  size: { w: number; h: number },
  filter?: (t: PickType) => boolean
): Pick | null {
  const rc = new THREE.Raycaster()
  rc.setFromCamera(ndc, camera)
  const ray = rc.ray
  const px = (ndc.x * 0.5 + 0.5) * size.w
  const py = (1 - (ndc.y * 0.5 + 0.5)) * size.h
  let best: Pick | null = null
  const consider = (p: Pick) => {
    if (filter && !filter(p.type)) return
    if (!best || p.depth < best.depth) best = p
  }
  const c = new THREE.Vector3()
  for (let i = 0; i < snap.nodeIds.length; i++) {
    c.set(nodePos[i * 3], nodePos[i * 3 + 1], nodePos[i * 3 + 2])
    const r = snap.nodes[i * NODE_STRIDE + 3]
    const dist = c.distanceTo(camera.position)
    const t = raySphere(ray, c, Math.max(r * 1.35, dist * 0.012))
    if (t !== null) consider({ type: 'node', id: snap.nodeIds[i], point: c.clone(), depth: t })
  }
  for (let i = 0; i < snap.organismIds.length; i++) {
    c.set(orgPos[i * 3], orgPos[i * 3 + 1], orgPos[i * 3 + 2])
    const r = snap.organisms[i * ORG_STRIDE + 6]
    const t = raySphere(ray, c, Math.max(r * 1.5, c.distanceTo(camera.position) * 0.012))
    if (t !== null) consider({ type: 'organism', id: snap.organismIds[i], point: c.clone(), depth: t - 0.5 })
  }
  if (best) return best
  // thin things, by screen distance
  let thin: { p: Pick; d: number } | null = null
  const tryThin = (type: PickType, id: number, a: THREE.Vector3, b: THREE.Vector3, tol: number) => {
    if (filter && !filter(type)) return
    if (!toScreen(a, camera, size.w, size.h, tmpA) || !toScreen(b, camera, size.w, size.h, tmpB)) return
    const { d, t } = segScreenDistance(px, py, tmpA, tmpB)
    if (d > tol) return
    const point = a.clone().lerp(b, t)
    if (!thin || d < thin.d) thin = { p: { type, id, point, depth: point.distanceTo(camera.position) }, d }
  }
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (let i = 0; i < snap.strandIds.length; i++) {
    const o = i * STRAND_STRIDE
    const ia = snap.strands[o]
    const ib = snap.strands[o + 1]
    if (ia < 0 || ib < 0) continue
    a.set(nodePos[ia * 3], nodePos[ia * 3 + 1], nodePos[ia * 3 + 2])
    b.set(nodePos[ib * 3], nodePos[ib * 3 + 1], nodePos[ib * 3 + 2])
    tryThin('strand', snap.strandIds[i], a, b, 9)
  }
  const ns = snap.segs.length / SEG_STRIDE
  for (let i = 0; i < ns; i++) {
    const o = i * SEG_STRIDE
    a.set(snap.segs[o], snap.segs[o + 1], snap.segs[o + 2])
    b.set(snap.segs[o + 3], snap.segs[o + 4], snap.segs[o + 5])
    tryThin('crystal', snap.segCrystal[i], a, b, 8)
  }
  if (thin) return (thin as { p: Pick }).p
  // ring halos: distance from the ray's hit on the ring plane to the ring circle
  for (let i = 0; i < snap.ringIds.length; i++) {
    const o = i * RING_STRIDE
    const centre = new THREE.Vector3(snap.rings[o], snap.rings[o + 1], snap.rings[o + 2])
    const n = new THREE.Vector3(snap.rings[o + 3], snap.rings[o + 4], snap.rings[o + 5])
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, centre)
    const hit = new THREE.Vector3()
    if (!ray.intersectPlane(plane, hit)) continue
    const r = snap.rings[o + 6]
    const d = Math.abs(hit.distanceTo(centre) - r)
    if (d < Math.max(1.2, r * 0.15)) consider({ type: 'ring', id: snap.ringIds[i], point: hit, depth: hit.distanceTo(camera.position) })
  }
  if (best) return best
  const nv = snap.veils.length / VEIL_STRIDE
  for (let i = 0; i < nv; i++) {
    const o = i * VEIL_STRIDE
    c.set(snap.veils[o], snap.veils[o + 1], snap.veils[o + 2])
    const t = raySphere(ray, c, snap.veils[o + 3])
    if (t !== null) consider({ type: 'veil', id: snap.veilIds[i], point: ray.at(t, new THREE.Vector3()), depth: t })
  }
  return best
}

/** Where the pointer meets a plane facing the camera through `through`. */
export function pointOnViewPlane(camera: THREE.Camera, ndc: THREE.Vector2, through: THREE.Vector3): THREE.Vector3 {
  const rc = new THREE.Raycaster()
  rc.setFromCamera(ndc, camera)
  const n = new THREE.Vector3()
  camera.getWorldDirection(n)
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, through)
  const out = new THREE.Vector3()
  if (!rc.ray.intersectPlane(plane, out)) out.copy(through)
  return out
}
