import { ANCHOR_ENERGY, ANCHOR_PHASE, ANCHOR_POS, FREQ_MAX, FREQ_MIN, LIMITS, MASS_MAX } from './constants'
import { breakSegments, nucleate } from './crystals'
import { envOf } from './environments'
import { deposit, pulseField } from './field'
import { clamp, finite, vlen, type Vec3 } from './math'
import { ARCHETYPES, spawnOrganism } from './organisms'
import { collapseNode, fractureStrand, shatterNode } from './physics'
import { randNormal } from './rng'
import type { Kind, WorldState } from './types'
import { addNode, addStrand, canConnect, capacity, emit, findEntity, invalidate, nodeById, radiusOf, removeNode, removeStrand, strandById } from './world'

// Every way the player can change the universe. Each command is checked; an invalid target
// gets a plain explanation and changes nothing.

export type Command =
  | { type: 'seed'; kind: Kind; p: Vec3; mass?: number; freq?: number; energy?: number }
  | { type: 'seedCrystal'; p: Vec3 }
  | { type: 'seedSpore'; p: Vec3; archetype?: string }
  | { type: 'connect'; a: number; b: number; coupling?: number; resistance?: number; twist?: number }
  | { type: 'grab'; id: number }
  | { type: 'drag'; id: number; p: Vec3 }
  | { type: 'release'; id: number; v?: Vec3 }
  | { type: 'nudge'; id: number; d: Vec3 }
  | { type: 'setStrand'; id: number; coupling?: number; resistance?: number; rest?: number; twist?: number; bias?: number; elasticity?: number }
  | { type: 'tune'; id: number; freq: number }
  | { type: 'pulse'; p: Vec3; strength: number; radius?: number }
  | { type: 'pull'; p: Vec3; strength: number; r?: number; ticks?: number }
  | { type: 'cut'; id: number }
  | { type: 'destabilize'; id: number; amount?: number; seg?: number }
  | { type: 'fuse'; a: number; b: number }
  | { type: 'veil'; p: Vec3; r: number; ticks?: number; mask?: number }
  | { type: 'unveil'; id: number }
  | { type: 'anchor'; id: number; flags: number }
  | { type: 'remove'; id: number }
  | { type: 'rename'; id: number; name: string }

export interface CommandResult {
  ok: boolean
  id?: number
  error?: string
}

const fail = (error: string): CommandResult => ({ ok: false, error })
const finiteVec = (p: Vec3 | undefined): p is Vec3 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

function inside(w: WorldState, p: Vec3): Vec3 {
  const R = envOf(w.env).radius * 0.95
  const r = vlen(p)
  return r > R ? { x: (p.x * R) / r, y: (p.y * R) / r, z: (p.z * R) / r } : { ...p }
}

/** Commands that only move things while held do not count as changes for "untouched" checks. */
export const PASSIVE = new Set(['rename'])

export function applyCommand(w: WorldState, c: Command): CommandResult {
  const r = apply(w, c)
  if (r.ok && !PASSIVE.has(c.type)) w.lastAction = w.tick
  return r
}

function apply(w: WorldState, c: Command): CommandResult {
  switch (c.type) {
    case 'seed': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      if (c.kind === 'grey' && !w.laws.mediators) return fail('The medium does not know grey yet. It wakes when you find resonance.')
      if (w.nodes.length >= LIMITS.nodes) return fail('This chamber is full. Fuse or fracture something first.')
      const n = addNode(w, c.kind, inside(w, c.p), { mass: c.mass, freq: c.freq })
      if (!n) return fail('This chamber is full.')
      if (c.energy !== undefined) n.energy = clamp(finite(c.energy), 0, capacity(n))
      w.acct.external += n.energy
      emit(w, 'seed', n.p, { a: n.id, text: n.kind })
      return { ok: true, id: n.id }
    }
    case 'seedCrystal': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      if (!w.laws.crystals) return fail('The medium cannot hold a crystal shape yet.')
      const p = inside(w, c.p)
      let anchor = null
      for (const n of w.nodes) {
        if (n.kind !== 'black') continue
        const d = Math.sqrt((n.p.x - p.x) ** 2 + (n.p.y - p.y) ** 2 + (n.p.z - p.z) ** 2)
        if (d < radiusOf(n) + 6 && !w.crystals.some((x) => x.anchor === n.id)) anchor = n
      }
      const cr = nucleate(w, envOf(w.env), anchor ? anchor.p : p, anchor)
      if (!cr) return fail('There is no room for another crystal.')
      return { ok: true, id: cr.id }
    }
    case 'seedSpore': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      if (w.mode === 'genesis') return fail('In Genesis, life has to emerge on its own.')
      if (!w.laws.life) return fail('The medium cannot carry life yet.')
      const base = ARCHETYPES[c.archetype ?? 'swimmer'] ?? ARCHETYPES.swimmer
      const g = base.map((x) => clamp(x + 0.05 * randNormal(w), 0, 1))
      const o = spawnOrganism(w, inside(w, c.p), g, null, 20)
      if (!o) return fail('There is no room for more life here.')
      w.acct.external += o.energy
      emit(w, 'seed', o.p, { a: o.id, text: 'life' })
      return { ok: true, id: o.id }
    }
    case 'connect': {
      const problem = canConnect(w, c.a, c.b, 70)
      if (problem) {
        const text: Record<string, string> = {
          same: 'A strand needs two different ends.',
          missing: 'Strands connect concentrations of the medium (light, dark or grey).',
          exists: 'These two are already connected.',
          full: 'One of them already holds as many strands as it can.',
          limit: 'The chamber holds as many strands as it can.',
          far: 'They are too far apart for a strand.'
        }
        return fail(text[problem])
      }
      const s = addStrand(w, c.a, c.b, { coupling: c.coupling, resistance: c.resistance, twist: c.twist, origin: 'player' })
      if (!s) return fail('The strand could not form.')
      const A = nodeById(w, c.a)!
      const B = nodeById(w, c.b)!
      emit(w, 'connect', { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2, z: (A.p.z + B.p.z) / 2 }, { a: c.a, b: c.b, text: String(s.id) })
      return { ok: true, id: s.id }
    }
    case 'grab': {
      const n = nodeById(w, c.id)
      const o = n ? null : w.organisms.find((x) => x.id === c.id)
      const t = n ?? o
      if (!t) return fail('The Hand can hold light, dark, grey, and living forms.')
      if (t.anchor & ANCHOR_POS) return fail('It is anchored in place. Release the anchor first.')
      t.held = true
      t.target = { ...t.p }
      return { ok: true, id: c.id }
    }
    case 'drag': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      const t = nodeById(w, c.id) ?? w.organisms.find((x) => x.id === c.id)
      if (!t || !t.held) return fail('Nothing is being held.')
      t.target = inside(w, c.p)
      return { ok: true, id: c.id }
    }
    case 'release': {
      const t = nodeById(w, c.id) ?? w.organisms.find((x) => x.id === c.id)
      if (!t) return fail('Nothing is being held.')
      t.held = false
      t.target = null
      if (finiteVec(c.v)) {
        const s = vlen(c.v)
        const k = s > 30 ? 30 / s : 1
        t.v = { x: c.v.x * k, y: c.v.y * k, z: c.v.z * k }
      }
      return { ok: true, id: c.id }
    }
    case 'nudge': {
      if (!finiteVec(c.d)) return fail('Not a direction.')
      const t = nodeById(w, c.id) ?? w.organisms.find((x) => x.id === c.id)
      if (!t) return fail('Select something to move.')
      if (t.anchor & ANCHOR_POS) return fail('It is anchored in place.')
      t.p = inside(w, { x: t.p.x + c.d.x, y: t.p.y + c.d.y, z: t.p.z + c.d.z })
      return { ok: true, id: c.id }
    }
    case 'setStrand': {
      const s = strandById(w, c.id)
      if (!s) return fail('Select a strand first.')
      if (s.anchored && (c.coupling !== undefined || c.rest !== undefined || c.twist !== undefined)) return fail('This strand is anchored. Release its anchor to change it.')
      if (c.coupling !== undefined) s.coupling = clamp(finite(c.coupling, s.coupling), 0, 2.5)
      if (c.resistance !== undefined) s.resistance = clamp(finite(c.resistance, s.resistance), 0.05, 6)
      if (c.rest !== undefined) s.rest = clamp(finite(c.rest, s.rest), 1.5, 90)
      if (c.twist !== undefined) s.twist = clamp(finite(c.twist, s.twist), -Math.PI * 2, Math.PI * 2)
      if (c.bias !== undefined) s.bias = clamp(finite(c.bias, s.bias), -1, 1)
      if (c.elasticity !== undefined) s.elasticity = clamp(finite(c.elasticity, s.elasticity), 0.05, 3)
      if (s.origin === 'spontaneous') s.origin = 'player'
      return { ok: true, id: s.id }
    }
    case 'tune': {
      const freq = clamp(finite(c.freq, NaN), FREQ_MIN, FREQ_MAX)
      if (!Number.isFinite(freq)) return fail('That is not a frequency.')
      const n = nodeById(w, c.id)
      if (n) {
        n.freq = freq
        return { ok: true, id: n.id }
      }
      const cr = w.crystals.find((x) => x.id === c.id)
      if (cr) {
        cr.freq = freq
        return { ok: true, id: cr.id }
      }
      const s = strandById(w, c.id)
      if (s) return fail('To tune a strand, change its coupling.')
      return fail('Tune works on light, dark, grey and crystals.')
    }
    case 'pulse': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      const strength = clamp(finite(c.strength, 1), 0.2, 12)
      const p = inside(w, c.p)
      pulseField(w.field, p, strength, clamp(finite(c.radius ?? 4, 4), 2, 14))
      emit(w, 'pulse', p, { value: strength })
      return { ok: true }
    }
    case 'pull': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      if (w.pulls.length >= 4) w.pulls.shift()
      const id = w.nextId++
      w.pulls.push({ id, p: inside(w, c.p), strength: clamp(finite(c.strength, 1), -3, 3), r: clamp(finite(c.r ?? 18, 18), 4, 50), ticks: clamp(Math.round(finite(c.ticks ?? 6, 6)), 1, 600) })
      return { ok: true, id }
    }
    case 'cut': {
      const s = strandById(w, c.id)
      if (!s) return fail('Fracture a strand by choosing it.')
      fractureStrand(w, s, null, 'cut')
      return { ok: true }
    }
    case 'destabilize': {
      const amount = clamp(finite(c.amount ?? 1, 1), 0.1, 3)
      const ent = findEntity(w, c.id)
      if (!ent) return fail('There is nothing there to fracture.')
      if (ent.type === 'strand') {
        fractureStrand(w, ent.ref as never, null, 'cut')
        return { ok: true }
      }
      if (ent.type === 'node') {
        const n = nodeById(w, c.id)!
        n.glow = 1
        if (n.kind === 'black') {
          if (n.energy / capacity(n) > 0.5 || amount >= 2) collapseNode(w, n)
          else {
            n.sat += Math.round(60 * amount)
            pulseField(w.field, n.p, 1.5, 3)
          }
        } else if (n.kind === 'white') {
          if (n.mass > 0.4) shatterNode(w, n)
          else pulseField(w.field, n.p, 1.5, 3)
        } else {
          const e = n.energy
          deposit(w.field.radiance, w.field, n.p, e)
          n.energy = 0
          n.mass *= 0.6
          pulseField(w.field, n.p, 2, 3)
          if (n.mass < 0.15) {
            removeNode(w, n.id)
            emit(w, 'dissolve', n.p, { a: n.id })
          }
        }
        return { ok: true }
      }
      if (ent.type === 'crystal') {
        const cr = w.crystals.find((x) => x.id === c.id)!
        const seg = c.seg !== undefined && c.seg >= 0 && c.seg < cr.segs.length ? c.seg : Math.max(0, Math.floor(cr.segs.length / 2))
        breakSegments(w, envOf(w.env), cr, [seg])
        return { ok: true }
      }
      if (ent.type === 'ring') {
        const ring = w.rings.find((x) => x.id === c.id)!
        const edges = ring.edges.map((id) => strandById(w, id)).filter(Boolean)
        if (!edges.length) return fail('The ring has no strand to break.')
        const weakest = edges.reduce((a, b) => (a!.strength - a!.stress < b!.strength - b!.stress ? a : b))!
        fractureStrand(w, weakest, null, 'cut')
        return { ok: true }
      }
      if (ent.type === 'organism') {
        const o = w.organisms.find((x) => x.id === c.id)!
        const hit = Math.min(o.energy, 8 * amount)
        o.energy -= hit
        deposit(w.field.radiance, w.field, o.p, hit)
        o.sens = Math.min(1, o.sens + 0.4)
        pulseField(w.field, o.p, 1.2, 2)
        return { ok: true }
      }
      return fail('That cannot be fractured.')
    }
    case 'fuse':
      return fuse(w, c.a, c.b)
    case 'veil': {
      if (!finiteVec(c.p)) return fail('That place is outside the chamber.')
      if (w.veils.length >= LIMITS.veils) return fail('There are already as many veils as the medium allows.')
      const id = w.nextId++
      w.veils.push({ id, p: inside(w, c.p), r: clamp(finite(c.r, 10), 3, 30), ticks: clamp(Math.round(finite(c.ticks ?? 900, 900)), 30, 9000), mask: c.mask ?? 31 })
      emit(w, 'veil', c.p, { a: id })
      return { ok: true, id }
    }
    case 'unveil': {
      const before = w.veils.length
      w.veils = w.veils.filter((v) => v.id !== c.id)
      return before === w.veils.length ? fail('There is no veil there.') : { ok: true }
    }
    case 'anchor': {
      const flags = Math.round(finite(c.flags, 0)) & 7
      const n = nodeById(w, c.id)
      if (n) {
        if (flags & ANCHOR_POS) {
          n.held = false
          n.target = null
          n.v = { x: 0, y: 0, z: 0 }
        }
        if (flags & ANCHOR_ENERGY && !(n.anchor & ANCHOR_ENERGY)) n.anchorEnergy = n.energy
        n.anchor = flags
        return { ok: true, id: n.id }
      }
      const o = w.organisms.find((x) => x.id === c.id)
      if (o) {
        o.anchor = flags & ANCHOR_POS
        return { ok: true, id: o.id }
      }
      const s = strandById(w, c.id)
      if (s) {
        s.anchored = flags !== 0
        return { ok: true, id: s.id }
      }
      return fail('Anchor holds light, dark, grey, strands and living forms.')
    }
    case 'remove': {
      if (w.mode !== 'lab') return fail('Removing things is only possible in the Laboratory.')
      const n = nodeById(w, c.id)
      if (n) {
        w.acct.external -= n.energy
        removeNode(w, n.id)
        return { ok: true }
      }
      const s = strandById(w, c.id)
      if (s) {
        removeStrand(w, s.id)
        return { ok: true }
      }
      const oi = w.organisms.findIndex((x) => x.id === c.id)
      if (oi >= 0) {
        w.acct.external -= w.organisms[oi].energy
        w.organisms.splice(oi, 1)
        w.bonds = w.bonds.filter((b) => b.a !== c.id && b.b !== c.id)
        return { ok: true }
      }
      const ci = w.crystals.findIndex((x) => x.id === c.id)
      if (ci >= 0) {
        w.acct.external -= w.crystals[ci].energy
        w.crystals.splice(ci, 1)
        return { ok: true }
      }
      return fail('There is nothing there to remove.')
    }
    case 'rename': {
      const name = String(c.name ?? '').slice(0, 60).trim() || null
      const ent = findEntity(w, c.id)
      if (!ent) return fail('There is nothing there to name.')
      ;(ent.ref as { name: string | null }).name = name
      return { ok: true, id: c.id }
    }
  }
  return fail('Unknown action.')
}

function fuse(w: WorldState, a: number, b: number): CommandResult {
  if (a === b) return fail('Fuse needs two different things.')
  const A = nodeById(w, a)
  const B = nodeById(w, b)
  if (A && B) {
    const d = Math.sqrt((A.p.x - B.p.x) ** 2 + (A.p.y - B.p.y) ** 2 + (A.p.z - B.p.z) ** 2)
    if (d > (radiusOf(A) + radiusOf(B)) * 3 + 6) return fail('Bring them closer together to fuse them.')
    const mass = Math.min(MASS_MAX, A.mass + B.mass)
    const energy = A.energy + B.energy
    const p = { x: (A.p.x * A.mass + B.p.x * B.mass) / (A.mass + B.mass), y: (A.p.y * A.mass + B.p.y * B.mass) / (A.mass + B.mass), z: (A.p.z * A.mass + B.p.z * B.mass) / (A.mass + B.mass) }
    let kind: Kind = A.kind
    let note = 'merged'
    if (A.kind !== B.kind) {
      if (A.kind === 'grey' || B.kind === 'grey') kind = A.kind === 'grey' ? B.kind : A.kind
      else {
        if (!w.laws.mediators) return fail('Light and dark cannot share a state until the medium knows grey.')
        kind = 'grey'
        note = 'balance'
      }
    }
    // A keeps its identity; B's strands move to A.
    const tm = A.mass + B.mass
    A.v = { x: (A.v.x * A.mass + B.v.x * B.mass) / tm, y: (A.v.y * A.mass + B.v.y * B.mass) / tm, z: (A.v.z * A.mass + B.v.z * B.mass) / tm }
    A.freq = clamp((A.freq * A.mass + B.freq * B.mass) / tm, FREQ_MIN, FREQ_MAX)
    A.kind = kind
    A.mass = kind === 'grey' && note === 'balance' ? Math.min(MASS_MAX, mass * 0.6) : mass
    A.p = p
    A.well = A.well || B.well
    A.glow = 1
    A.sat = 0
    const cap = capacity(A)
    A.energy = Math.min(energy, cap)
    if (energy > cap) {
      deposit(w.field.radiance, w.field, p, energy - cap)
      pulseField(w.field, p, 2 + (energy - cap) * 0.05, 4)
    }
    const moved = w.strands.filter((s) => s.a === b || s.b === b)
    const keepA = new Set(w.strands.filter((s) => s.a === a || s.b === a).map((s) => (s.a === a ? s.b : s.a)))
    for (const s of moved) {
      const other = s.a === b ? s.b : s.a
      if (other === a || keepA.has(other)) {
        removeStrand(w, s.id)
        continue
      }
      if (s.a === b) s.a = a
      else s.b = a
      keepA.add(other)
    }
    B.energy = 0
    removeNode(w, b)
    for (const cr of w.crystals) if (cr.anchor === b) cr.anchor = a
    invalidate(w)
    emit(w, 'fuse', p, { a, b, text: note })
    return { ok: true, id: a }
  }
  const RA = w.rings.find((r) => r.id === a)
  const RB = w.rings.find((r) => r.id === b)
  if (RA && RB) {
    let made = 0
    const pairs: [number, number, number][] = []
    for (const x of RA.members) for (const y of RB.members) {
      if (x === y) continue
      const X = nodeById(w, x)
      const Y = nodeById(w, y)
      if (X && Y) pairs.push([x, y, (X.p.x - Y.p.x) ** 2 + (X.p.y - Y.p.y) ** 2 + (X.p.z - Y.p.z) ** 2])
    }
    pairs.sort((p, q) => p[2] - q[2])
    for (const [x, y] of pairs) {
      if (made >= 2) break
      if (addStrand(w, x, y, { coupling: 0.6, origin: 'fuse' })) made++
    }
    if (!made) return fail('These structures cannot reach each other.')
    emit(w, 'fuse', RA.center, { a, b, text: 'structures' })
    return { ok: true, id: a }
  }
  const OA = w.organisms.find((o) => o.id === a)
  const OB = w.organisms.find((o) => o.id === b)
  if (OA && OB) {
    if (OA.lineage !== OB.lineage) return fail('Only related forms can be joined.')
    if (w.bonds.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) return fail('They are already bonded.')
    w.bonds.push({ a, b, age: 0 })
    emit(w, 'bond', OA.p, { a, b })
    return { ok: true }
  }
  return fail('Fuse joins two concentrations, two rings, or two related living forms.')
}

export { ANCHOR_ENERGY, ANCHOR_PHASE, ANCHOR_POS }
