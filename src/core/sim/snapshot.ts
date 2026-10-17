import { BIRTH_LOCK_TICKS, STRAND_MAX_CURRENT_PER_STRENGTH } from './constants'
import { envOf, thresholdPlane } from './environments'
import { bodyRadius, lobes, maxEnergy, STATES } from './organisms'
import type { SimEvent, WorldState } from './types'
import { capacity, radiusOf } from './world'

// What the renderer receives each frame: compact typed arrays read straight from the
// authoritative state. Every visual is driven by these numbers, nothing else.

export const NODE_STRIDE = 16 // x y z radius fill phase kind sat glow freq flags energy mass fx fy fz
export const STRAND_STRIDE = 14 // a b current tension stress amp twist lock coupling oscFreq carried origin resistance birth
export const ORG_STRIDE = 20 // x y z hx hy hz radius energy family lobes shell phase flash state hue speed siphon held sens diet
export const SEG_STRIDE = 10 // ax ay az bx by bz thick stress crystal growing
export const RING_STRIDE = 14 // cx cy cz nx ny nz radius coherence winding energy membrane membraneEnergy membraneRadius members
export const FRAG_STRIDE = 4
export const VEIL_STRIDE = 5
export const PULL_STRIDE = 5

export const KIND_CODE = { black: 0, white: 1, grey: 2 } as const
export const FAMILY_CODE = { membrane: 0, motile: 1, oscillating: 2, adaptive: 3 } as const
export const ORIGIN_CODE = { player: 0, spontaneous: 1, birth: 2, regrowth: 3, fuse: 4, collapse: 5, preset: 6 } as const

export interface RenderSnapshot {
  tick: number
  env: string
  plane: number
  nodes: Float32Array
  nodeIds: Int32Array
  strands: Float32Array
  strandIds: Int32Array
  organisms: Float32Array
  organismIds: Int32Array
  segs: Float32Array
  crystalIds: Int32Array
  segCrystal: Int32Array
  fragments: Float32Array
  rings: Float32Array
  ringIds: Int32Array
  ringMembers: Int32Array
  ringOffsets: Int32Array
  bonds: Int32Array
  veils: Float32Array
  pulls: Float32Array
  radiance: Float32Array | null
  signal: Float32Array | null
  fieldN: number
  fieldHalf: number
  stats: { nodes: number; strands: number; organisms: number; crystals: number; rings: number; energy: number; generation: number }
  events: SimEvent[]
}

function hueOf(id: number): number {
  let h = id * 2654435761
  h = (h ^ (h >>> 13)) >>> 0
  return (h % 1000) / 1000
}

export function buildSnapshot(w: WorldState, opts: { fields?: boolean; events?: SimEvent[] } = {}): RenderSnapshot {
  const nN = w.nodes.length
  const nodes = new Float32Array(nN * NODE_STRIDE)
  const nodeIds = new Int32Array(nN)
  const index = new Map<number, number>()
  let energy = 0
  for (let i = 0; i < nN; i++) {
    const n = w.nodes[i]
    index.set(n.id, i)
    nodeIds[i] = n.id
    const o = i * NODE_STRIDE
    const C = capacity(n)
    nodes[o] = n.p.x
    nodes[o + 1] = n.p.y
    nodes[o + 2] = n.p.z
    nodes[o + 3] = radiusOf(n)
    nodes[o + 4] = C > 0 ? n.energy / C : 0
    nodes[o + 5] = n.phase
    nodes[o + 6] = KIND_CODE[n.kind]
    nodes[o + 7] = n.kind === 'black' ? Math.min(1, n.sat / 150) : n.kind === 'white' ? Math.min(1, n.sat / 240) : Math.min(1, n.starve / 900)
    nodes[o + 8] = n.glow
    nodes[o + 9] = n.freq
    nodes[o + 10] = (n.well ? 1 : 0) | (n.held ? 2 : 0) | (n.anchor ? 4 : 0) | (n.name ? 8 : 0)
    nodes[o + 11] = n.energy
    nodes[o + 12] = n.mass
    nodes[o + 13] = n.force.x
    nodes[o + 14] = n.force.y
    nodes[o + 15] = n.force.z
    energy += n.energy
  }
  const nS = w.strands.length
  const strands = new Float32Array(nS * STRAND_STRIDE)
  const strandIds = new Int32Array(nS)
  for (let i = 0; i < nS; i++) {
    const s = w.strands[i]
    strandIds[i] = s.id
    const o = i * STRAND_STRIDE
    const strength = s.strength * envOf(w.env).strandStrength
    strands[o] = index.get(s.a) ?? -1
    strands[o + 1] = index.get(s.b) ?? -1
    strands[o + 2] = s.current
    strands[o + 3] = s.tension / (12 * strength)
    strands[o + 4] = s.stress
    strands[o + 5] = s.amp / (STRAND_MAX_CURRENT_PER_STRENGTH * strength)
    strands[o + 6] = s.twist
    strands[o + 7] = Math.min(1, s.lock / 90)
    strands[o + 8] = s.coupling
    strands[o + 9] = s.oscFreq
    strands[o + 10] = s.carried
    strands[o + 11] = ORIGIN_CODE[s.origin]
    strands[o + 12] = s.resistance
    strands[o + 13] = s.birthDone ? -1 : Math.min(1, s.lock / BIRTH_LOCK_TICKS)
  }
  const nO = w.organisms.length
  const organisms = new Float32Array(nO * ORG_STRIDE)
  const organismIds = new Int32Array(nO)
  const orgIndex = new Map<number, number>()
  for (let i = 0; i < nO; i++) {
    const g = w.organisms[i]
    orgIndex.set(g.id, i)
    organismIds[i] = g.id
    const o = i * ORG_STRIDE
    organisms[o] = g.p.x
    organisms[o + 1] = g.p.y
    organisms[o + 2] = g.p.z
    organisms[o + 3] = g.heading.x
    organisms[o + 4] = g.heading.y
    organisms[o + 5] = g.heading.z
    organisms[o + 6] = bodyRadius(g.genome)
    organisms[o + 7] = g.energy / maxEnergy(g.genome)
    organisms[o + 8] = FAMILY_CODE[g.family]
    organisms[o + 9] = lobes(g.genome)
    organisms[o + 10] = g.genome[11]
    organisms[o + 11] = g.phase
    organisms[o + 12] = g.flash
    organisms[o + 13] = STATES.indexOf(g.state)
    organisms[o + 14] = hueOf(g.lineage)
    organisms[o + 15] = Math.sqrt(g.v.x * g.v.x + g.v.y * g.v.y + g.v.z * g.v.z)
    organisms[o + 16] = g.siphon
    organisms[o + 17] = g.held ? 1 : 0
    organisms[o + 18] = g.sens
    organisms[o + 19] = g.genome[3]
    energy += g.energy
  }
  let segCount = 0
  for (const c of w.crystals) segCount += c.segs.length
  const segs = new Float32Array(segCount * SEG_STRIDE)
  const segCrystal = new Int32Array(segCount)
  const crystalIds = new Int32Array(w.crystals.length)
  let si = 0
  w.crystals.forEach((c, ci) => {
    crystalIds[ci] = c.id
    energy += c.energy
    for (const s of c.segs) {
      const o = si * SEG_STRIDE
      segs[o] = s.ax
      segs[o + 1] = s.ay
      segs[o + 2] = s.az
      segs[o + 3] = s.bx
      segs[o + 4] = s.by
      segs[o + 5] = s.bz
      segs[o + 6] = s.thick
      segs[o + 7] = s.stress
      segs[o + 8] = ci
      segs[o + 9] = s.growing ? 1 : 0
      segCrystal[si] = c.id
      si++
    }
  })
  const fragments = new Float32Array(w.fragments.length * FRAG_STRIDE)
  w.fragments.forEach((f, i) => {
    fragments.set([f.p.x, f.p.y, f.p.z, f.energy], i * FRAG_STRIDE)
  })
  const confirmed = w.rings.filter((r) => r.confirmed)
  const rings = new Float32Array(confirmed.length * RING_STRIDE)
  const ringIds = new Int32Array(confirmed.length)
  const ringOffsets = new Int32Array(confirmed.length + 1)
  const mem: number[] = []
  confirmed.forEach((r, i) => {
    ringIds[i] = r.id
    ringOffsets[i] = mem.length
    for (const m of r.members) mem.push(index.get(m) ?? -1)
    rings.set(
      [r.center.x, r.center.y, r.center.z, r.normal.x, r.normal.y, r.normal.z, r.radius, r.coherence, r.winding, r.energy, r.membrane ? 1 : 0, r.membrane?.energy ?? 0, r.membrane?.radius ?? 0, r.members.length],
      i * RING_STRIDE
    )
    if (r.membrane) energy += r.membrane.energy
  })
  ringOffsets[confirmed.length] = mem.length
  const bonds = new Int32Array(w.bonds.length * 2)
  w.bonds.forEach((b, i) => {
    bonds[i * 2] = orgIndex.get(b.a) ?? -1
    bonds[i * 2 + 1] = orgIndex.get(b.b) ?? -1
  })
  const veils = new Float32Array(w.veils.length * VEIL_STRIDE)
  w.veils.forEach((v, i) => veils.set([v.p.x, v.p.y, v.p.z, v.r, v.ticks], i * VEIL_STRIDE))
  const pulls = new Float32Array(w.pulls.length * PULL_STRIDE)
  w.pulls.forEach((p, i) => pulls.set([p.p.x, p.p.y, p.p.z, p.r, p.strength], i * PULL_STRIDE))
  const R = w.field.radiance
  for (let i = 0; i < R.length; i++) energy += R[i]
  return {
    tick: w.tick,
    env: w.env,
    plane: thresholdPlane(envOf(w.env), w.envClock),
    nodes,
    nodeIds,
    strands,
    strandIds,
    organisms,
    organismIds,
    segs,
    crystalIds,
    segCrystal,
    fragments,
    rings,
    ringIds,
    ringMembers: new Int32Array(mem),
    ringOffsets,
    bonds,
    veils,
    pulls,
    radiance: opts.fields ? Float32Array.from(w.field.radiance) : null,
    signal: opts.fields ? new Float32Array(w.field.signal) : null,
    fieldN: w.field.n,
    fieldHalf: w.field.half,
    stats: {
      nodes: nN,
      strands: nS,
      organisms: nO,
      crystals: w.crystals.length,
      rings: confirmed.length,
      energy,
      generation: w.stats.maxGeneration
    },
    events: opts.events ?? []
  }
}

/** The buffers to transfer (zero-copy) when posting a snapshot from a worker. */
export function snapshotTransferables(s: RenderSnapshot): ArrayBuffer[] {
  const list = [s.nodes, s.nodeIds, s.strands, s.strandIds, s.organisms, s.organismIds, s.segs, s.crystalIds, s.segCrystal, s.fragments, s.rings, s.ringIds, s.ringMembers, s.ringOffsets, s.bonds, s.veils, s.pulls]
  if (s.radiance) list.push(s.radiance)
  if (s.signal) list.push(s.signal)
  return list.map((a) => a.buffer as ArrayBuffer)
}
