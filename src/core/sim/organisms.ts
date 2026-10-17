import { ANCHOR_POS, GENES, GRAVITY, LIMITS, ORGANISM_DECIDE_EVERY, PRESSURE, SOFTENING } from './constants'
import type { EnvParams } from './environments'
import { cellOf, deposit, gradient, sample, vibration, withdraw, pulseField } from './field'
import { TAU, clamp, vlen, vnorm, type Vec3 } from './math'
import { nextRandom, randNormal, randRange, randUnit } from './rng'
import { SpatialHash } from './spatial'
import type { Family, OrgState, Organism, SimNode, SimStrand, WorldState } from './types'
import { boundaryForce } from './physics'
import { capacity, emit, fill, newId, radiusOf } from './world'

// Life-like forms. Everything they do comes from their genome, what they sense, and a
// small utility-based choice of what to do next. No AI service is ever involved.
//
// Genes (all 0..1):
//   0 size  1 speed  2 sense  3 diet (0 eats light, 1 eats vibration)  4 tolerance of bright light
//   5 caution  6 sociality  7 fertility  8 variability (mutation, plasticity)  9 rhythm
//   10 symmetry (body lobes)  11 shell (resists shocks, eats less)  12 tether (feeds on strand flow)

export const GENE_NAMES = ['size', 'speed', 'sense', 'diet', 'tolerance', 'caution', 'sociality', 'fertility', 'variability', 'rhythm', 'symmetry', 'shell', 'tether']

export const STATES: OrgState[] = ['explore', 'feed', 'flee', 'rest', 'dormant', 'divide', 'bond', 'follow']

export const ARCHETYPES: Record<string, number[]> = {
  swimmer: [0.35, 0.75, 0.6, 0.15, 0.4, 0.45, 0.25, 0.5, 0.25, 0.3, 0.3, 0.25, 0.1],
  drifter: [0.6, 0.1, 0.4, 0.1, 0.6, 0.2, 0.55, 0.45, 0.2, 0.3, 0.6, 0.5, 0.05],
  pulser: [0.4, 0.15, 0.5, 0.8, 0.5, 0.3, 0.65, 0.5, 0.25, 0.8, 0.8, 0.4, 0.05],
  seeker: [0.3, 0.6, 0.7, 0.4, 0.4, 0.4, 0.3, 0.55, 0.85, 0.4, 0.45, 0.2, 0.3],
  siphon: [0.3, 0.55, 0.65, 0.3, 0.5, 0.3, 0.2, 0.5, 0.3, 0.3, 0.2, 0.3, 0.9]
}

export const bodyRadius = (g: number[]) => 0.6 + 1.6 * g[0]
export const maxEnergy = (g: number[]) => 6 + 40 * bodyRadius(g)
export const maxSpeed = (g: number[]) => (g[1] < 0.35 ? 0.15 + 0.6 * g[1] : 0.4 + 6 * g[1])
export const senseRadius = (g: number[]) => 4 + 16 * g[2]
export const lobes = (g: number[]) => 2 + Math.round(g[10] * 6)

export function familyOf(g: number[]): Family {
  if (g[1] >= 0.35) return g[8] >= 0.6 ? 'adaptive' : 'motile'
  return g[9] >= 0.55 && g[6] >= 0.3 ? 'oscillating' : 'membrane'
}

export function genomeDistance(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < GENES; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s / GENES) * 2
}

export function spawnOrganism(w: WorldState, p: Vec3, genome: number[], parent: Organism | null, energy?: number): Organism | null {
  if (w.organisms.length >= LIMITS.organisms) return null
  const g = genome.map((x) => clamp(Number.isFinite(x) ? x : 0.5, 0, 1))
  while (g.length < GENES) g.push(0.5)
  const id = newId(w)
  let lineage = parent ? parent.lineage : id
  if (!parent) w.lineages.push({ id, genome: [...g], born: w.tick })
  else {
    const founder = w.lineages.find((l) => l.id === parent.lineage)
    if (founder && genomeDistance(founder.genome, g) > 0.35) {
      lineage = id
      w.lineages.push({ id, genome: [...g], born: w.tick })
      emit(w, 'speciation', p, { a: id, b: parent.lineage })
    }
  }
  if (w.lineages.length > 240) {
    const alive = new Set(w.organisms.map((o) => o.lineage))
    alive.add(lineage)
    w.lineages = w.lineages.filter((l) => alive.has(l.id))
  }
  const o: Organism = {
    id,
    p: { ...p },
    v: { x: 0, y: 0, z: 0 },
    heading: randUnit(w),
    energy: energy ?? maxEnergy(g) * 0.5,
    age: 0,
    generation: parent ? parent.generation + 1 : 0,
    parent: parent ? parent.id : 0,
    lineage,
    genome: g,
    family: familyOf(g),
    state: 'explore',
    stateTicks: 0,
    sens: 0,
    memory: null,
    memoryTicks: 0,
    phase: randRange(w, 0, TAU),
    flash: 0,
    util: [0, 0, 0, 0, 0, 0, 0, 0],
    desired: { x: 0, y: 0, z: 0 },
    desiredSpeed: 0,
    sensed: { light: 0, vibration: 0, danger: 0, kin: 0, strand: 0, food: 0 },
    held: false,
    target: null,
    anchor: 0,
    name: null,
    born: w.tick,
    siphon: 0
  }
  w.organisms.push(o)
  w.stats.maxGeneration = Math.max(w.stats.maxGeneration, o.generation)
  return o
}

function vibGradient(w: WorldState, p: Vec3): Vec3 {
  const f = w.field
  const h = 2
  return {
    x: (vibration(f, { x: p.x + h, y: p.y, z: p.z }) - vibration(f, { x: p.x - h, y: p.y, z: p.z })) / (2 * h),
    y: (vibration(f, { x: p.x, y: p.y + h, z: p.z }) - vibration(f, { x: p.x, y: p.y - h, z: p.z })) / (2 * h),
    z: (vibration(f, { x: p.x, y: p.y, z: p.z + h }) - vibration(f, { x: p.x, y: p.y, z: p.z - h })) / (2 * h)
  }
}

function nearestStrandPoint(w: WorldState, byId: Map<number, SimNode>, p: Vec3, r: number): { s: SimStrand; q: Vec3; d: number; t: number } | null {
  let best: { s: SimStrand; q: Vec3; d: number; t: number } | null = null
  for (const s of w.strands) {
    const A = byId.get(s.a)
    const B = byId.get(s.b)
    if (!A || !B) continue
    const abx = B.p.x - A.p.x
    const aby = B.p.y - A.p.y
    const abz = B.p.z - A.p.z
    const l2 = abx * abx + aby * aby + abz * abz || 1e-6
    let t = ((p.x - A.p.x) * abx + (p.y - A.p.y) * aby + (p.z - A.p.z) * abz) / l2
    t = clamp(t, 0, 1)
    const q = { x: A.p.x + abx * t, y: A.p.y + aby * t, z: A.p.z + abz * t }
    const d = Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2)
    if (d <= r && (!best || d < best.d)) best = { s, q, d, t }
  }
  return best
}

const orgHash = new SpatialHash<Organism>(8)

export function organismStep(w: WorldState, env: EnvParams, dt: number, byId: Map<number, SimNode>, nodeHash: SpatialHash<SimNode>): void {
  if (!w.organisms.length) return
  const f = w.field
  orgHash.build(w.organisms)
  const cap = Math.min(env.maxOrganisms, LIMITS.organisms)
  const born: Organism[] = []
  const dead = new Set<number>()
  const damp = Math.exp(-Math.max(0.25, env.viscosity * 0.6) * dt)
  const sigma = w.laws.adaptation ? 1 : 0

  for (const o of w.organisms) {
    o.age++
    o.stateTicks++
    o.flash *= Math.exp(-4 * dt)
    o.siphon *= Math.exp(-3 * dt)
    const g = o.genome
    const R = bodyRadius(g)
    const maxE = maxEnergy(g)
    const light = sample(f.radiance, f, o.p)
    const vib = vibration(f, o.p)
    const tolThr = 2 + 10 * g[4]
    const shockThr = 0.6 + 3 * g[11]
    const plastic = o.family === 'adaptive' ? 0.85 : 0.25
    const caution = clamp(g[5] + o.sens * plastic, 0, 1.5)
    const dormant = o.state === 'dormant'

    // Metabolism: a body costs energy to keep, motion costs more.
    const speed2 = o.v.x * o.v.x + o.v.y * o.v.y + o.v.z * o.v.z
    let burn = (0.05 + 0.1 * R + 0.03 * g[1] + 0.012 * speed2) * dt
    if (dormant) burn *= 0.1
    o.energy -= burn
    if (o.energy < 0) {
      w.acct.dissipated += burn + o.energy
      o.energy = 0
    } else w.acct.dissipated += burn

    // Feeding: light from the radiance field, or vibration from the signal field.
    const intakeK = (1 - 0.3 * g[11]) * (dormant ? 0.3 : 1)
    const wantLight = (1 - g[3]) * 2.0 * R * light * intakeK * dt
    let gotLight = 0
    if (wantLight > 0) gotLight = withdraw(f.radiance, f, o.p, Math.min(wantLight, maxE - o.energy))
    o.energy += gotLight
    let gotVib = g[3] * 1.2 * R * Math.max(0, vib - 0.05) * intakeK * dt
    gotVib = Math.max(0, Math.min(gotVib, maxE - o.energy))
    if (gotVib > 0) {
      o.energy += gotVib
      w.acct.harvested += gotVib
      const ci = cellOf(f, o.p)
      if (ci >= 0) f.signalVel[ci] *= 1 - Math.min(0.3, gotVib * 0.5)
    }
    if (gotLight + gotVib > 0.35 * R * dt) {
      o.memory = { ...o.p }
      o.memoryTicks = 900
    } else if (o.memoryTicks > 0) o.memoryTicks--
    if (o.memoryTicks <= 0) o.memory = null

    // Harm: too much light, or a shock beyond what the shell can take. Sensitises.
    let harm = 0
    if (light > tolThr) harm += (light - tolThr) * 0.12 * dt
    if (vib > shockThr) {
      harm += (vib - shockThr) * 0.5 * dt
      o.sens = Math.min(1, o.sens + 0.4 * dt * (vib - shockThr))
    } else o.sens = Math.max(0, o.sens - 0.015 * dt)
    if (harm > 0) {
      const h = Math.min(harm, Math.max(0, o.energy))
      o.energy -= h
      deposit(f.radiance, f, o.p, h)
    }

    // Oscillating forms flash on each cycle; flashes pull neighbours into step.
    if (o.family === 'oscillating') {
      o.phase += TAU * (0.2 + 1.3 * g[9]) * dt
      if (o.phase >= TAU) {
        o.phase -= TAU
        o.flash = 1
        pulseField(f, o.p, 0.35, 2)
        orgHash.query(o.p, 10, (n) => {
          if (n.id !== o.id && n.family === 'oscillating') n.phase = Math.min(TAU - 1e-6, n.phase + 0.22)
        })
      }
    }

    // Strand siphoning.
    let strandNear: ReturnType<typeof nearestStrandPoint> = null
    if (g[12] > 0.3 && (o.id + w.tick) % 2 === 0) strandNear = nearestStrandPoint(w, byId, o.p, senseRadius(g))
    if (strandNear && strandNear.d < R + 1.5 && Math.abs(strandNear.s.current) > 0.3 && o.state === 'follow') {
      const A = byId.get(strandNear.s.a)!
      const B = byId.get(strandNear.s.b)!
      const src = fill(A) >= fill(B) ? A : B
      const take = Math.min(src.energy, g[12] * 0.35 * Math.abs(strandNear.s.current) * dt, Math.max(0, maxE - o.energy))
      if (take > 0) {
        src.energy -= take
        o.energy += take
        o.siphon = 1
      }
    }

    // Decide what to do (staggered, a few times a second).
    if ((o.id + w.tick) % ORGANISM_DECIDE_EVERY === 0) {
      const hunger = clamp(1 - o.energy / maxE, 0, 1)
      const foodHere = g[3] < 0.5 ? light : vib
      const fg = g[3] < 0.5 ? gradient(f.radiance, f, o.p) : vibGradient(w, o.p)
      const fgm = vlen(fg)
      const danger = Math.max(0, vib - shockThr * 0.6) / shockThr + Math.max(0, light - tolThr * 0.8) / tolThr
      let kin = 0
      let nearestKin: Organism | null = null
      let nd = Infinity
      orgHash.query(o.p, senseRadius(g), (n, d2) => {
        if (n.id === o.id || n.lineage !== o.lineage) return
        kin++
        if (d2 < nd) {
          nd = d2
          nearestKin = n
        }
      })
      if (!strandNear && g[12] > 0.3) strandNear = nearestStrandPoint(w, byId, o.p, senseRadius(g))
      o.sensed = { light, vibration: vib, danger, kin, strand: strandNear ? Math.abs(strandNear.s.current) : 0, food: foodHere }
      const divThr = (0.5 + 0.4 * g[7]) * maxE
      const u = [
        0.15 + 0.15 * g[1] + 0.25 / (1 + foodHere * 3), // explore: more when there is nothing here
        hunger * 0.7 + Math.min(1, foodHere / 2) * 0.35 + Math.min(1, fgm * 4) * 0.4 + (o.memory ? 0.15 * hunger : 0), // feed
        caution * danger * 1.6, // flee
        o.energy < 0.15 * maxE && foodHere < 0.25 ? 0.9 : 0, // rest
        0, // dormant (entered through rest)
        o.energy > divThr && o.age > 240 && w.organisms.length + born.length < cap ? 1.2 : 0, // divide
        g[6] * Math.min(1, kin / 3) * (1 - hunger) * 0.9, // bond
        strandNear ? g[12] * Math.min(1, Math.abs(strandNear.s.current)) * (0.4 + hunger) * 1.3 : 0 // follow
      ]
      const cur = STATES.indexOf(o.state)
      if (cur >= 0) u[cur] += 0.1
      let best = 0
      for (let i = 1; i < u.length; i++) if (u[i] > u[best]) best = i
      let next = STATES[best]
      if (next === 'rest' && o.energy < 0.12 * maxE) next = 'dormant'
      if (o.state === 'dormant' && next !== 'dormant' && foodHere > 0.3) emit(w, 'woke', o.p, { a: o.id })
      if (o.state === 'dormant' && foodHere <= 0.3 && best !== 2) next = 'dormant'
      if (next !== o.state) {
        o.state = next
        o.stateTicks = 0
      }
      o.util = u.map((x) => Math.round(x * 1000) / 1000)

      // Steering: a desired velocity from the chosen behaviour.
      const ms = maxSpeed(g)
      let desired: Vec3 = { x: 0, y: 0, z: 0 }
      let speed = ms * 0.5
      if (o.state === 'feed') {
        const toward = o.memory && fgm < 0.01 ? vnorm({ x: o.memory.x - o.p.x, y: o.memory.y - o.p.y, z: o.memory.z - o.p.z }) : vnorm(fg, o.heading)
        desired = toward
        speed = ms * 0.8
      } else if (o.state === 'flee') {
        const away = g[3] < 0.5 && light > tolThr ? gradient(f.radiance, f, o.p) : vibGradient(w, o.p)
        desired = vnorm({ x: -away.x, y: -away.y, z: -away.z }, { x: -o.heading.x, y: -o.heading.y, z: -o.heading.z })
        speed = ms * 1.2
      } else if (o.state === 'bond' && nearestKin) {
        const k = nearestKin as Organism
        desired = vnorm({ x: k.p.x - o.p.x, y: k.p.y - o.p.y, z: k.p.z - o.p.z })
        speed = ms * 0.6
      } else if (o.state === 'follow' && strandNear) {
        const q = strandNear.q
        const toward = { x: q.x - o.p.x, y: q.y - o.p.y, z: q.z - o.p.z }
        desired = vnorm(toward, o.heading)
        speed = ms * 0.7
      } else if (o.state === 'explore') {
        const jitter = randUnit(w)
        o.heading = vnorm({ x: o.heading.x + jitter.x * 0.35, y: o.heading.y + jitter.y * 0.35, z: o.heading.z + jitter.z * 0.35 })
        desired = o.heading
      } else if (o.state === 'rest' || o.state === 'dormant' || o.state === 'divide') {
        speed = 0
      }
      o.desired = desired
      o.desiredSpeed = speed
    }

    // Movement.
    if (o.held && o.target) {
      o.v = { x: clamp(((o.target.x - o.p.x) / dt) * 0.35, -40, 40), y: clamp(((o.target.y - o.p.y) / dt) * 0.35, -40, 40), z: clamp(((o.target.z - o.p.z) / dt) * 0.35, -40, 40) }
    } else if (o.anchor & ANCHOR_POS) {
      o.v = { x: 0, y: 0, z: 0 }
    } else {
      const d = o.desired
      const sp = o.desiredSpeed
      const k = Math.min(1, 2.2 * dt)
      o.v.x += (d.x * sp - o.v.x) * k
      o.v.y += (d.y * sp - o.v.y) * k
      o.v.z += (d.z * sp - o.v.z) * k
      const F = { x: 0, y: 0, z: 0 }
      nodeHash.query(o.p, 22, (n, d2) => {
        const dd = Math.sqrt(d2) || 1e-6
        const ux = (n.p.x - o.p.x) / dd
        const uy = (n.p.y - o.p.y) / dd
        const uz = (n.p.z - o.p.z) / dd
        let a = 0
        if (n.kind === 'black') a += (0.25 * GRAVITY * n.mass * (0.4 + fill(n))) / (d2 + SOFTENING * SOFTENING)
        if (n.kind === 'white') a -= (0.25 * PRESSURE * n.mass * fill(n) * R * R) / (Math.pow(dd, 2.2) + SOFTENING)
        const overlap = radiusOf(n) + R - dd
        if (overlap > 0) a -= 20 * overlap
        F.x += ux * a
        F.y += uy * a
        F.z += uz * a
      })
      orgHash.query(o.p, R * 3, (n, d2) => {
        if (n.id === o.id) return
        const dd = Math.sqrt(d2) || 1e-3
        const push = (R * 3 - dd) * 0.8
        F.x -= ((n.p.x - o.p.x) / dd) * push
        F.y -= ((n.p.y - o.p.y) / dd) * push
        F.z -= ((n.p.z - o.p.z) / dd) * push
      })
      boundaryForce(env, o.p, 1, F)
      o.v.x = (o.v.x + F.x * dt) * damp
      o.v.y = (o.v.y + F.y * dt) * damp
      o.v.z = (o.v.z + F.z * dt) * damp
      const s = vlen(o.v)
      const lim = maxSpeed(g) * 2 + 2
      if (s > lim) {
        o.v.x *= lim / s
        o.v.y *= lim / s
        o.v.z *= lim / s
      }
      if (s > 0.05) o.heading = vnorm(o.v, o.heading)
    }
    const nx = o.p.x + o.v.x * dt
    const ny = o.p.y + o.v.y * dt
    const nz = o.p.z + o.v.z * dt
    if (w.veils.some((v) => v.mask & 16)) {
      for (const v of w.veils) {
        if (!(v.mask & 16)) continue
        const inBefore = (o.p.x - v.p.x) ** 2 + (o.p.y - v.p.y) ** 2 + (o.p.z - v.p.z) ** 2 <= v.r * v.r
        const inAfter = (nx - v.p.x) ** 2 + (ny - v.p.y) ** 2 + (nz - v.p.z) ** 2 <= v.r * v.r
        if (inBefore !== inAfter) {
          o.v = { x: -o.v.x, y: -o.v.y, z: -o.v.z }
        }
      }
    }
    o.p = { x: o.p.x + o.v.x * dt, y: o.p.y + o.v.y * dt, z: o.p.z + o.v.z * dt }
    const rr = vlen(o.p)
    if (rr > env.radius) o.p = { x: (o.p.x * env.radius) / rr, y: (o.p.y * env.radius) / rr, z: (o.p.z * env.radius) / rr }

    // Division with variation.
    if (o.state === 'divide' && o.energy > (0.5 + 0.4 * g[7]) * maxE && w.organisms.length + born.length < cap) {
      const sd = (0.015 + 0.1 * g[8]) * sigma
      const child = g.map((x) => clamp(x + sd * randNormal(w), 0, 1))
      const give = o.energy * 0.45
      const lose = o.energy * 0.1
      o.energy -= give + lose
      deposit(f.radiance, f, o.p, lose)
      const dir = randUnit(w)
      const c = spawnOrganism(w, { x: o.p.x + dir.x * R * 1.6, y: o.p.y + dir.y * R * 1.6, z: o.p.z + dir.z * R * 1.6 }, child, o, give)
      if (c) {
        born.push(c)
        c.v = { x: dir.x * 1.5, y: dir.y * 1.5, z: dir.z * 1.5 }
        w.stats.divisions++
        emit(w, 'division', o.p, { a: o.id, b: c.id, value: c.generation })
      } else {
        o.energy += give
      }
      o.state = 'explore'
      o.stateTicks = 0
    }

    const lifespan = 5000 + 7000 * (1 - g[8]) + 2000 * g[11]
    if (o.energy <= 1e-9 || o.age > lifespan) {
      if (o.energy > 0) deposit(f.radiance, f, o.p, o.energy)
      o.energy = 0
      dead.add(o.id)
    }
  }

  if (dead.size) {
    for (const o of w.organisms) if (dead.has(o.id)) emit(w, 'death', o.p, { a: o.id, b: o.lineage, value: o.age })
    w.stats.deaths += dead.size
    w.organisms = w.organisms.filter((o) => !dead.has(o.id))
    w.bonds = w.bonds.filter((b) => !dead.has(b.a) && !dead.has(b.b))
  }
  bondStep(w, dt)
  if (w.tick % 150 === 0) sampleTraits(w)
}

function bondStep(w: WorldState, dt: number): void {
  const byId = new Map<number, Organism>()
  for (const o of w.organisms) byId.set(o.id, o)
  const count = new Map<number, number>()
  for (const b of w.bonds) {
    count.set(b.a, (count.get(b.a) ?? 0) + 1)
    count.set(b.b, (count.get(b.b) ?? 0) + 1)
  }
  if (w.tick % 15 === 0) {
    const have = new Set(w.bonds.map((b) => (b.a < b.b ? `${b.a}:${b.b}` : `${b.b}:${b.a}`)))
    for (const o of w.organisms) {
      if (o.genome[6] < 0.4 || (count.get(o.id) ?? 0) >= 3) continue
      if (o.state !== 'bond' && o.state !== 'rest' && o.state !== 'explore') continue
      orgHash.query(o.p, 4, (n) => {
        if (n.id <= o.id || n.lineage !== o.lineage || n.genome[6] < 0.4) return
        if ((count.get(n.id) ?? 0) >= 3 || (count.get(o.id) ?? 0) >= 3) return
        const key = `${o.id}:${n.id}`
        if (have.has(key)) return
        w.bonds.push({ a: o.id, b: n.id, age: 0 })
        have.add(key)
        count.set(o.id, (count.get(o.id) ?? 0) + 1)
        count.set(n.id, (count.get(n.id) ?? 0) + 1)
        emit(w, 'bond', o.p, { a: o.id, b: n.id })
      })
    }
  }
  const keep: typeof w.bonds = []
  for (const b of w.bonds) {
    const A = byId.get(b.a)
    const B = byId.get(b.b)
    if (!A || !B) continue
    const dx = B.p.x - A.p.x
    const dy = B.p.y - A.p.y
    const dz = B.p.z - A.p.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3
    if (d > 9) continue
    b.age++
    const k = 1.5 * (d - 2.5) * dt
    A.v.x += (dx / d) * k
    A.v.y += (dy / d) * k
    A.v.z += (dz / d) * k
    B.v.x -= (dx / d) * k
    B.v.y -= (dy / d) * k
    B.v.z -= (dz / d) * k
    const share = (A.energy - B.energy) * 0.2 * dt
    A.energy -= share
    B.energy += share
    keep.push(b)
  }
  w.bonds = keep
}

export function sampleTraits(w: WorldState): void {
  const n = w.organisms.length
  const means = new Array(GENES).fill(0)
  let maxGen = 0
  for (const o of w.organisms) {
    for (let i = 0; i < GENES; i++) means[i] += o.genome[i]
    maxGen = Math.max(maxGen, o.generation)
  }
  if (n) for (let i = 0; i < GENES; i++) means[i] = Math.round((means[i] / n) * 1000) / 1000
  w.traitHistory.push({ t: w.tick, means, count: n, maxGen })
  if (w.traitHistory.length > 240) w.traitHistory.shift()
}

/** Genome for an organism quickened from a membrane: inherits the structure's character. */
export function genomeFromRing(w: WorldState, freq: number, members: SimNode[], energy: number): number[] {
  const blacks = members.filter((m) => m.kind === 'black').length
  const whites = members.filter((m) => m.kind === 'white').length
  const greys = members.filter((m) => m.kind === 'grey').length
  const n = Math.max(1, members.length)
  const g = [
    clamp(0.25 + energy / 200, 0, 1),
    clamp(0.2 + (whites / n) * 0.8 + randRange(w, -0.15, 0.15), 0, 1),
    clamp(0.4 + randRange(w, -0.2, 0.2), 0, 1),
    clamp(greys / n + randRange(w, -0.1, 0.1), 0, 1),
    clamp(0.3 + (blacks / n) * 0.5, 0, 1),
    clamp(0.35 + randRange(w, -0.2, 0.2), 0, 1),
    clamp(0.3 + randRange(w, 0, 0.4), 0, 1),
    clamp(0.5 + randRange(w, -0.2, 0.2), 0, 1),
    clamp(0.25 + randRange(w, 0, 0.5), 0, 1),
    clamp(freq / 1.5, 0, 1),
    clamp(members.length / 8, 0, 1),
    clamp((blacks / n) * 0.8 + randRange(w, 0, 0.2), 0, 1),
    clamp(randRange(w, 0, 0.6), 0, 1)
  ]
  return g
}

export function randomGenome(w: WorldState): number[] {
  return Array.from({ length: GENES }, () => nextRandom(w))
}

export { capacity }
