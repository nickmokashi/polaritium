import { BASE_FREQ, CAPACITY_PER_MASS, FIELD_N, FREQ_MAX, FREQ_MIN, LIMITS, MASS_MAX, MASS_MIN, RULES_VERSION, STRAND_MAX_PER_NODE } from './constants'
import { envOf } from './environments'
import { makeField } from './field'
import { clamp, perpendicular, vcopy, vdist, vnorm, vsub, type Vec3 } from './math'
import { randRange, seedFrom } from './rng'
import type { EnvId, Kind, Laws, Mode, SimEvent, SimNode, SimStrand, StrandOrigin, WorldState } from './types'

export const ALL_LAWS: Laws = { phase: true, mediators: true, crystals: true, membranes: true, life: true, adaptation: true }
export const GENESIS_LAWS: Laws = { phase: false, mediators: false, crystals: false, membranes: false, life: false, adaptation: false }

export function createWorld(opts: { seed: number | string; env: EnvId; mode?: Mode; laws?: Partial<Laws> }): WorldState {
  const env = envOf(opts.env)
  const seed = typeof opts.seed === 'number' ? opts.seed >>> 0 : seedFrom(opts.seed)
  const mode = opts.mode ?? 'lab'
  return {
    rulesVersion: RULES_VERSION,
    seed,
    rng: seed || 1,
    tick: 0,
    env: env.id,
    mode,
    nextId: 1,
    nodes: [],
    strands: [],
    crystals: [],
    fragments: [],
    organisms: [],
    bonds: [],
    lineages: [],
    rings: [],
    ghosts: [],
    veils: [],
    pulls: [],
    field: makeField(FIELD_N, env.radius * 1.05),
    acct: { generated: 0, harvested: 0, dissipated: 0, converted: 0, external: 0 },
    laws: { ...(mode === 'genesis' ? GENESIS_LAWS : ALL_LAWS), ...(opts.laws ?? {}) },
    events: [],
    log: [],
    scars: [],
    envClock: 0,
    lastAction: 0,
    traitHistory: [],
    stats: { births: 0, deaths: 0, divisions: 0, fractures: 0, collapses: 0, quickenings: 0, maxGeneration: 0 },
    chamber: null,
    found: {},
    memo: {}
  }
}

export const newId = (w: WorldState): number => w.nextId++

// ---- lookups. Rebuilt lazily whenever the entity lists change length or order. ----

interface Index {
  nodes: Map<number, SimNode>
  strands: Map<number, SimStrand>
  degree: Map<number, number>
  pairs: Set<string>
  sig: string
}

const indexes = new WeakMap<WorldState, Index>()

function signature(w: WorldState): string {
  const n = w.nodes
  const s = w.strands
  return `${n.length}:${n.length ? n[0].id + '-' + n[n.length - 1].id : ''}:${s.length}:${s.length ? s[0].id + '-' + s[s.length - 1].id : ''}`
}

export function invalidate(w: WorldState): void {
  indexes.delete(w)
}

export function index(w: WorldState): Index {
  const sig = signature(w)
  let ix = indexes.get(w)
  if (ix && ix.sig === sig) return ix
  ix = { nodes: new Map(), strands: new Map(), degree: new Map(), pairs: new Set(), sig }
  for (const n of w.nodes) ix.nodes.set(n.id, n)
  for (const s of w.strands) {
    ix.strands.set(s.id, s)
    ix.degree.set(s.a, (ix.degree.get(s.a) ?? 0) + 1)
    ix.degree.set(s.b, (ix.degree.get(s.b) ?? 0) + 1)
    ix.pairs.add(pairKey(s.a, s.b))
  }
  indexes.set(w, ix)
  return ix
}

export const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)
export const nodeById = (w: WorldState, id: number): SimNode | undefined => index(w).nodes.get(id)
export const strandById = (w: WorldState, id: number): SimStrand | undefined => index(w).strands.get(id)
export const degree = (w: WorldState, id: number): number => index(w).degree.get(id) ?? 0
export const connected = (w: WorldState, a: number, b: number): boolean => index(w).pairs.has(pairKey(a, b))

export function strandsOf(w: WorldState, id: number): SimStrand[] {
  return w.strands.filter((s) => s.a === id || s.b === id)
}

// ---- node properties ----

export function capacity(n: SimNode): number {
  return CAPACITY_PER_MASS[n.kind] * n.mass * (n.well ? 2 : 1)
}

/** Potential: light pushes, dark pulls, grey is neutral. Flow runs from high to low. */
export function potential(n: SimNode): number {
  const f = fill(n)
  return n.kind === 'white' ? f + 0.4 : n.kind === 'black' ? f - 0.4 : f
}

export function fill(n: SimNode): number {
  const c = capacity(n)
  return c > 0 ? clamp(n.energy / c, 0, 1) : 0
}

export function radiusOf(n: SimNode): number {
  const base = 1.15 * Math.cbrt(n.mass)
  const f = fill(n)
  if (n.kind === 'white') return base * (0.85 + 0.35 * f)
  if (n.kind === 'black') return base * (n.well ? 0.85 : 1) * (1 - 0.28 * f)
  return base * 0.9
}

export interface NodeOpts {
  mass?: number
  energy?: number
  freq?: number
  phase?: number
  v?: Vec3
  name?: string | null
}

export function addNode(w: WorldState, kind: Kind, p: Vec3, o: NodeOpts = {}): SimNode | null {
  if (w.nodes.length >= LIMITS.nodes) return null
  const mass = clamp(o.mass ?? 1, MASS_MIN, MASS_MAX)
  const n: SimNode = {
    id: newId(w),
    kind,
    p: vcopy(p),
    v: o.v ? vcopy(o.v) : { x: 0, y: 0, z: 0 },
    force: { x: 0, y: 0, z: 0 },
    mass,
    energy: 0,
    freq: clamp(o.freq ?? BASE_FREQ[kind] * randRange(w, 0.85, 1.15), FREQ_MIN, FREQ_MAX),
    phase: o.phase ?? randRange(w, 0, Math.PI * 2),
    stress: 0,
    age: 0,
    sat: 0,
    starve: 0,
    anchor: 0,
    held: false,
    target: null,
    anchorEnergy: 0,
    glow: 0.6,
    well: false,
    name: o.name ?? null,
    born: w.tick,
    zone: 0
  }
  n.energy = clamp(o.energy ?? capacity(n) * (kind === 'white' ? 0.5 : kind === 'black' ? 0.1 : 0.3), 0, capacity(n))
  w.nodes.push(n)
  invalidate(w)
  return n
}

export interface StrandOpts {
  coupling?: number
  resistance?: number
  rest?: number
  elasticity?: number
  twist?: number
  bias?: number
  strength?: number
  origin?: StrandOrigin
}

export type ConnectProblem = 'same' | 'missing' | 'exists' | 'full' | 'limit' | 'far'

export function canConnect(w: WorldState, a: number, b: number, maxDist = Infinity): ConnectProblem | null {
  if (a === b) return 'same'
  const A = nodeById(w, a)
  const B = nodeById(w, b)
  if (!A || !B) return 'missing'
  if (connected(w, a, b)) return 'exists'
  if (degree(w, a) >= STRAND_MAX_PER_NODE || degree(w, b) >= STRAND_MAX_PER_NODE) return 'full'
  if (w.strands.length >= LIMITS.strands) return 'limit'
  if (vdist(A.p, B.p) > maxDist) return 'far'
  return null
}

export function addStrand(w: WorldState, a: number, b: number, o: StrandOpts = {}): SimStrand | null {
  if (canConnect(w, a, b)) return null
  const A = nodeById(w, a)!
  const B = nodeById(w, b)!
  const dir = vnorm(vsub(B.p, A.p))
  const s: SimStrand = {
    id: newId(w),
    a,
    b,
    coupling: clamp(o.coupling ?? 0.35, 0, 2.5),
    rest: Math.max(1.5, o.rest ?? vdist(A.p, B.p)),
    elasticity: clamp(o.elasticity ?? 0.6, 0.05, 3),
    resistance: clamp(o.resistance ?? 1.5, 0.05, 6),
    twist: o.twist ?? 0,
    bias: clamp(o.bias ?? 0, -1, 1),
    current: 0,
    tension: 0,
    stress: 0,
    strength: clamp(o.strength ?? 1, 0.1, 4),
    lock: 0,
    prevDelta: 0,
    drift: 1,
    mean: 0,
    vari: 0,
    amp: 0,
    oscFreq: 0,
    lastSign: 0,
    crossings: 0,
    crossTimer: 0,
    idle: 0,
    axis: perpendicular(dir),
    origin: o.origin ?? 'player',
    anchored: false,
    born: w.tick,
    birthDone: o.origin === 'birth',
    carried: 0
  }
  w.strands.push(s)
  invalidate(w)
  return s
}

export function removeStrand(w: WorldState, id: number): SimStrand | null {
  const i = w.strands.findIndex((s) => s.id === id)
  if (i < 0) return null
  const [s] = w.strands.splice(i, 1)
  invalidate(w)
  return s
}

/** Removes a node and every strand touching it. Its energy goes back into the field. */
export function removeNode(w: WorldState, id: number, energyTo: 'field' | 'external' = 'field'): SimNode | null {
  const i = w.nodes.findIndex((n) => n.id === id)
  if (i < 0) return null
  const [n] = w.nodes.splice(i, 1)
  w.strands = w.strands.filter((s) => s.a !== id && s.b !== id)
  for (const c of w.crystals) if (c.anchor === id) c.anchor = -1
  w.scars = w.scars.filter((s) => s.a !== id && s.b !== id)
  invalidate(w)
  return n
}

// ---- events ----

const LOGGED = new Set([
  'collapse',
  'shatter',
  'birth',
  'fracture',
  'transform',
  'dissolve',
  'ringFormed',
  'ringLost',
  'membrane',
  'quickening',
  'division',
  'death',
  'speciation',
  'bond',
  'crystal',
  'crystalBreak',
  'regrowth',
  'quake',
  'pulse',
  'woke',
  'finding',
  'fuse',
  'law',
  'strandFaded',
  'seed',
  'connect',
  'cut'
])

export function emit(w: WorldState, type: string, p: Vec3 | null, extra: Partial<SimEvent> = {}): SimEvent {
  const e: SimEvent = { t: w.tick, type, x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, ...extra }
  if (w.events.length < LIMITS.events) w.events.push(e)
  if (LOGGED.has(type)) {
    w.log.push(e)
    if (w.log.length > 300) w.log.splice(0, w.log.length - 300)
  }
  return e
}

/** Every bit of energy in the universe right now. */
export function totalEnergy(w: WorldState): number {
  let s = 0
  for (const n of w.nodes) s += n.energy
  for (const c of w.crystals) s += c.energy
  for (const f of w.fragments) s += f.energy
  for (const o of w.organisms) s += o.energy
  for (const r of w.rings) if (r.membrane) s += r.membrane.energy
  const R = w.field.radiance
  for (let i = 0; i < R.length; i++) s += R[i]
  return s
}

export function findEntity(w: WorldState, id: number): { type: 'node' | 'strand' | 'crystal' | 'organism' | 'ring' | 'veil'; ref: unknown } | null {
  const n = nodeById(w, id)
  if (n) return { type: 'node', ref: n }
  const s = strandById(w, id)
  if (s) return { type: 'strand', ref: s }
  const c = w.crystals.find((x) => x.id === id)
  if (c) return { type: 'crystal', ref: c }
  const o = w.organisms.find((x) => x.id === id)
  if (o) return { type: 'organism', ref: o }
  const r = w.rings.find((x) => x.id === id)
  if (r) return { type: 'ring', ref: r }
  const v = w.veils.find((x) => x.id === id)
  if (v) return { type: 'veil', ref: v }
  return null
}
