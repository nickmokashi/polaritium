import { LIMITS, MEMBRANE_AGE, MEMBRANE_COHERENCE, MEMBRANE_ENERGY, QUICKEN_ENERGY, RING_CONFIRM_CHECKS, RING_LOCK_TICKS, STRUCTURE_INTERVAL, DT } from './constants'
import type { EnvParams } from './environments'
import { deposit, gradient, pulseField, sample, withdraw } from './field'
import { TAU, vcross, vlen, vnorm, wrapAngle, type Vec3 } from './math'
import { genomeFromRing, spawnOrganism } from './organisms'
import type { Ring, SimNode, WorldState } from './types'
import { capacity, emit, newId } from './world'

// Structures are found, not placed. Every few ticks the network of phase-locked strands is
// searched for closed loops. A loop that persists becomes a Ring with an identity that
// survives members joining or leaving. A coherent, energised ring can grow a Membrane, and
// a membrane holding enough energy across a gradient can quicken: life appears in it.

interface Cycle {
  members: number[]
  edges: number[]
}

export function findCycles(w: WorldState, minLock = RING_LOCK_TICKS): Cycle[] {
  const adj = new Map<number, { to: number; s: number }[]>()
  const edges = w.strands.filter((s) => s.lock >= minLock && s.stress < 0.6).sort((a, b) => a.id - b.id)
  for (const s of edges) {
    if (!adj.has(s.a)) adj.set(s.a, [])
    if (!adj.has(s.b)) adj.set(s.b, [])
    adj.get(s.a)!.push({ to: s.b, s: s.id })
    adj.get(s.b)!.push({ to: s.a, s: s.id })
  }
  const parent = new Map<number, { p: number; s: number }>()
  const depth = new Map<number, number>()
  const treeEdges = new Set<number>()
  const roots = [...adj.keys()].sort((a, b) => a - b)
  for (const r of roots) {
    if (depth.has(r)) continue
    depth.set(r, 0)
    parent.set(r, { p: -1, s: -1 })
    const q = [r]
    while (q.length) {
      const u = q.shift()!
      for (const e of adj.get(u)!) {
        if (depth.has(e.to)) continue
        depth.set(e.to, depth.get(u)! + 1)
        parent.set(e.to, { p: u, s: e.s })
        treeEdges.add(e.s)
        q.push(e.to)
      }
    }
  }
  const out: Cycle[] = []
  const seen = new Set<string>()
  for (const s of edges) {
    if (treeEdges.has(s.id)) continue
    let u = s.a
    let v = s.b
    const pu: number[] = [u]
    const pv: number[] = [v]
    const eu: number[] = []
    const ev: number[] = []
    let guard = 0
    while (u !== v && guard++ < 40) {
      const du = depth.get(u) ?? 0
      const dv = depth.get(v) ?? 0
      if (du >= dv) {
        const p = parent.get(u)!
        if (p.p < 0) break
        eu.push(p.s)
        u = p.p
        pu.push(u)
      } else {
        const p = parent.get(v)!
        if (p.p < 0) break
        ev.push(p.s)
        v = p.p
        pv.push(v)
      }
    }
    if (u !== v) continue
    const members = [...pu, ...pv.slice(0, -1).reverse()]
    if (members.length < 3 || members.length > 8) continue
    const key = [...members].sort((a, b) => a - b).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ members, edges: [...eu, ...ev.reverse(), s.id] })
  }
  return out
}

function jaccard(a: number[], b: number[]): number {
  const sa = new Set(a)
  let inter = 0
  for (const x of b) if (sa.has(x)) inter++
  return inter / (a.length + b.length - inter)
}

export function ringProperties(w: WorldState, r: Ring, byId: Map<number, SimNode>): void {
  const ms = r.members.map((id) => byId.get(id)).filter(Boolean) as SimNode[]
  if (!ms.length) return
  const c = { x: 0, y: 0, z: 0 }
  for (const m of ms) {
    c.x += m.p.x / ms.length
    c.y += m.p.y / ms.length
    c.z += m.p.z / ms.length
  }
  let nrm = { x: 0, y: 0, z: 0 }
  let rad = 0
  let sx = 0
  let sy = 0
  let energy = 0
  let freq = 0
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i]
    const b = ms[(i + 1) % ms.length]
    const cr = vcross({ x: a.p.x - c.x, y: a.p.y - c.y, z: a.p.z - c.z }, { x: b.p.x - c.x, y: b.p.y - c.y, z: b.p.z - c.z })
    nrm = { x: nrm.x + cr.x, y: nrm.y + cr.y, z: nrm.z + cr.z }
    rad += Math.sqrt((a.p.x - c.x) ** 2 + (a.p.y - c.y) ** 2 + (a.p.z - c.z) ** 2) / ms.length
    sx += Math.cos(a.phase)
    sy += Math.sin(a.phase)
    energy += a.energy
    freq += a.freq / ms.length
  }
  let wind = 0
  let circ = 0
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i]
    const b = ms[(i + 1) % ms.length]
    wind += wrapAngle(b.phase - a.phase)
    const s = w.strands.find((x) => (x.a === a.id && x.b === b.id) || (x.a === b.id && x.b === a.id))
    if (s) circ += s.a === a.id ? s.current : -s.current
  }
  r.center = c
  r.normal = vnorm(nrm, { x: 0, y: 1, z: 0 })
  r.radius = rad
  r.coherence = Math.sqrt(sx * sx + sy * sy) / ms.length
  r.winding = Math.round(wind / TAU)
  r.energy = energy
  r.freq = freq
  r.circulation = circ / ms.length
}

export function structureStep(w: WorldState, env: EnvParams, byId: Map<number, SimNode>): void {
  if (w.tick % STRUCTURE_INTERVAL !== 0) return
  const dtS = DT * STRUCTURE_INTERVAL
  if (w.laws.phase) {
    const cycles = findCycles(w)
    const used = new Set<number>()
    for (const r of w.rings) {
      let best = -1
      let bj = 0
      for (let i = 0; i < cycles.length; i++) {
        if (used.has(i)) continue
        const j = jaccard(r.members, cycles[i].members)
        if (j > bj) {
          bj = j
          best = i
        }
      }
      if (best >= 0 && bj >= 0.5) {
        used.add(best)
        if (cycles[best].members.length !== r.members.length) r.sizes.push(cycles[best].members.length)
        r.members = cycles[best].members
        r.edges = cycles[best].edges
        r.seen++
        r.missed = 0
      } else r.missed++
    }
    w.ghosts = (w.ghosts ?? []).filter((g) => w.tick - g.lostAt < 300)
    for (let i = 0; i < cycles.length; i++) {
      if (used.has(i) || w.rings.length >= 60) continue
      const gi = w.ghosts.findIndex((g) => jaccard(g.ring.members, cycles[i].members) >= 0.5)
      if (gi >= 0) {
        const g = w.ghosts.splice(gi, 1)[0].ring
        if (cycles[i].members.length !== g.members.length) g.sizes.push(cycles[i].members.length)
        g.members = cycles[i].members
        g.edges = cycles[i].edges
        g.missed = 0
        g.seen++
        w.rings.push(g)
        emit(w, 'ringFormed', g.center, { a: g.id, value: g.members.length, b: g.winding, text: 'returned' })
        continue
      }
      w.rings.push({
        id: newId(w),
        members: cycles[i].members,
        edges: cycles[i].edges,
        center: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        radius: 0,
        coherence: 0,
        winding: 0,
        freq: 0,
        energy: 0,
        circulation: 0,
        age: 0,
        seen: 1,
        missed: 0,
        confirmed: false,
        membrane: null,
        name: null,
        born: w.tick,
        sizes: [cycles[i].members.length]
      })
    }
  } else {
    for (const r of w.rings) r.missed++
  }

  const keep: Ring[] = []
  for (const r of w.rings) {
    if (r.missed >= (r.confirmed ? 10 : 4) || r.members.some((m) => !byId.has(m))) {
      if (r.confirmed) {
        ringProperties(w, r, byId)
        emit(w, 'ringLost', r.center, { a: r.id, value: r.members.length })
        w.ghosts.push({ ring: { ...r, membrane: null, members: r.members.filter((m) => byId.has(m)) }, lostAt: w.tick })
      }
      if (r.membrane) {
        deposit(w.field.radiance, w.field, r.center, r.membrane.energy)
        pulseField(w.field, r.center, 2 + r.membrane.energy * 0.03, Math.max(3, r.radius))
        emit(w, 'membraneBurst', r.center, { a: r.id, value: r.membrane.energy })
        r.membrane = null
      }
      continue
    }
    if (r.missed === 0) r.age += STRUCTURE_INTERVAL
    ringProperties(w, r, byId)
    if (!r.confirmed && r.seen >= RING_CONFIRM_CHECKS) {
      r.confirmed = true
      emit(w, 'ringFormed', r.center, { a: r.id, value: r.members.length, b: r.winding })
    }
    if (r.confirmed) membraneStep(w, env, r, byId, dtS)
    keep.push(r)
  }
  w.rings = keep
}

function membraneStep(w: WorldState, env: EnvParams, r: Ring, byId: Map<number, SimNode>, dtS: number): void {
  const f = w.field
  const need = MEMBRANE_ENERGY * (r.members.length === 3 ? 1.5 : 1)
  if (!r.membrane) {
    if (w.laws.membranes && r.coherence >= MEMBRANE_COHERENCE && r.energy >= need && r.age >= MEMBRANE_AGE) {
      r.membrane = { energy: 0, radius: Math.max(2.5, r.radius * 1.1), permeability: 0.4, quickenings: 0, age: 0 }
      emit(w, 'membrane', r.center, { a: r.id, value: r.members.length })
    }
    return
  }
  const m = r.membrane
  m.age += STRUCTURE_INTERVAL
  m.radius += (Math.max(2.5, r.radius * 1.1) - m.radius) * 0.3
  // A membrane encloses energy: it drinks the radiance inside it, and what members spare.
  const R = sample(f.radiance, f, r.center)
  const got = withdraw(f.radiance, f, r.center, Math.min(m.permeability * R * dtS * m.radius * 0.25, 140 - m.energy))
  m.energy += got
  for (const id of r.members) {
    const n = byId.get(id)
    if (!n) continue
    const extra = n.energy - capacity(n) * 0.7
    if (extra > 0) {
      const t = Math.min(extra, 0.3 * dtS)
      n.energy -= t
      m.energy += t
    }
  }
  const leak = m.energy * 0.01 * dtS
  m.energy -= leak
  deposit(f.radiance, f, r.center, leak)
  if (m.energy > 140) {
    deposit(f.radiance, f, r.center, m.energy - 140)
    m.energy = 140
  }
  const grad = vlen(gradient(f.radiance, f, r.center)) * m.radius
  if (w.laws.life && m.quickenings < 6 && m.energy >= QUICKEN_ENERGY * env.lifeEase && (grad > 0.15 || m.age > 900) && w.organisms.length < Math.min(LIMITS.organisms, env.maxOrganisms)) {
    const members = r.members.map((id) => byId.get(id)).filter(Boolean) as SimNode[]
    const genome = genomeFromRing(w, r.freq, members, m.energy)
    const o = spawnOrganism(w, r.center, genome, null, 30)
    if (o) {
      m.energy -= 30
      m.quickenings++
      w.stats.quickenings++
      pulseField(f, r.center, 1.5, 3)
      emit(w, 'quickening', r.center, { a: o.id, b: r.id })
    }
  }
}

export function ringOf(w: WorldState, nodeId: number): Ring | undefined {
  return w.rings.find((r) => r.confirmed && r.members.includes(nodeId))
}

export type { Vec3 }
