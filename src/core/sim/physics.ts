import {
  ANCHOR_ENERGY,
  ANCHOR_PHASE,
  ANCHOR_POS,
  BIRTH_LOCK_TICKS,
  BIRTH_MIN_FLOW,
  BLACK_COLLAPSE_TICKS,
  BLACK_INTAKE,
  BLACK_LEAK,
  BLACK_SATURATION,
  COLLISION_K,
  FORCE_CUTOFF,
  FREQ_MAX,
  FREQ_MIN,
  GRAVITY,
  GREY_FIRE_FILL,
  GREY_FIRE_RELEASE,
  GREY_PULSE_COUPLING,
  GREY_STARVE_TICKS,
  HEBB_RATE,
  IDLE_DECAY,
  LIMITS,
  LOCK_RATE,
  MASS_MAX,
  MASS_MIN,
  MAX_SPEED,
  PHASE_GAIN,
  PRESSURE,
  SOFTENING,
  STRAND_DAMP,
  STRAND_DRIVE,
  STRAND_INERTIA,
  STRAND_MAX_CURRENT_PER_STRENGTH,
  STRAND_MAX_PER_NODE,
  STRAND_SPRING,
  TWIST_DRIVE,
  WHITE_GEN_RATE,
  WHITE_OVERLOAD_TICKS,
  WHITE_RADIATE
} from './constants'
import type { EnvParams } from './environments'
import { thresholdPlane } from './environments'
import { cellOf, deposit, pulseField, sample, vibration, withdraw } from './field'
import { TAU, clamp, emaK, finite, vcross, vdot, vlen, vnorm, wrapAngle, wrapPhase, type Vec3 } from './math'
import { nextRandom, randNormal, randRange, randUnit } from './rng'
import { SpatialHash } from './spatial'
import type { SimNode, SimStrand, WorldState } from './types'
import { addNode, addStrand, capacity, emit, fill, invalidate, potential, radiusOf, removeNode, removeStrand } from './world'


export interface StepScratch {
  byId: Map<number, SimNode>
  force: Map<number, Vec3>
  dphase: Map<number, number>
  hash: SpatialHash<SimNode>
  veilOf: Map<number, number>
}

export function makeScratch(w: WorldState): StepScratch {
  const byId = new Map<number, SimNode>()
  for (const n of w.nodes) byId.set(n.id, n)
  return { byId, force: new Map(), dphase: new Map(), hash: new SpatialHash<SimNode>(FORCE_CUTOFF), veilOf: new Map() }
}

/** Which veil (1-based) each node is inside, for masking influences. */
export function assignVeils(w: WorldState, sc: StepScratch): void {
  sc.veilOf.clear()
  if (!w.veils.length) return
  for (const n of w.nodes) {
    for (let i = 0; i < w.veils.length; i++) {
      const v = w.veils[i]
      const dx = n.p.x - v.p.x
      const dy = n.p.y - v.p.y
      const dz = n.p.z - v.p.z
      if (dx * dx + dy * dy + dz * dz <= v.r * v.r) {
        sc.veilOf.set(n.id, i + 1)
        break
      }
    }
  }
}

export function veilBlocks(w: WorldState, sc: StepScratch, a: number, b: number, flag: number): boolean {
  if (!w.veils.length) return false
  const va = sc.veilOf.get(a) ?? 0
  const vb = sc.veilOf.get(b) ?? 0
  if (va === vb) return false
  const v = w.veils[(va || vb) - 1]
  return !!v && (v.mask & flag) !== 0
}

/** Environment drivers: quakes, harmonic settling, the moving threshold. */
export function environmentDrivers(w: WorldState, env: EnvParams, dt: number): void {
  w.envClock += dt
  if (env.quakePeriod > 0) {
    const before = Math.floor((w.envClock - dt) / env.quakePeriod)
    const after = Math.floor(w.envClock / env.quakePeriod)
    if (after > before) {
      const a = randRange(w, 0, TAU)
      const p = { x: Math.cos(a) * env.radius * 0.5, y: -env.radius * 0.55, z: Math.sin(a) * env.radius * 0.5 }
      pulseField(w.field, p, env.quakeStrength * 4, 14)
      emit(w, 'quake', p, { value: env.quakeStrength })
    }
  }
  if (env.harmonicBase > 0) {
    for (const n of w.nodes) {
      if (n.anchor & ANCHOR_PHASE) continue
      const h = Math.max(1, Math.round(n.freq / env.harmonicBase)) * env.harmonicBase
      n.freq += (h - n.freq) * emaK(dt, 30)
    }
  }
}

/** What each expression does on its own: emit, absorb, fire, grow, starve. */
export function nodeIntrinsics(w: WorldState, env: EnvParams, dt: number, sc: StepScratch): void {
  const f = w.field
  for (const n of w.nodes) {
    n.age++
    n.glow *= Math.exp(-3 * dt)
    const C = capacity(n)
    const fl = n.energy / C
    if (n.kind === 'white') {
      const gen = WHITE_GEN_RATE * n.mass * Math.max(0, 1 - fl) * dt
      n.energy += gen
      w.acct.generated += gen
      const local = sample(f.radiance, f, n.p)
      const out = Math.min(n.energy, (WHITE_RADIATE * n.energy * dt) / (1 + local / 40))
      n.energy -= out
      deposit(f.radiance, f, n.p, out)
      if (n.energy / C > 0.98) n.sat++
      else n.sat = Math.max(0, n.sat - 2)
      // Abundance grows a light slowly.
      if (fl > 0.8 && n.mass < 3.5) n.mass = Math.min(3.5, n.mass + 0.01 * dt * (fl - 0.8) * 5)
    } else if (n.kind === 'black') {
      const local = sample(f.radiance, f, n.p)
      const want = BLACK_INTAKE * n.mass * (n.well ? 2.5 : 1) * Math.max(0, 1 - fl) * local * dt
      const got = withdraw(f.radiance, f, n.p, Math.min(want, C - n.energy))
      n.energy += got
      const leak = BLACK_LEAK * n.energy * dt
      n.energy -= leak
      deposit(f.radiance, f, n.p, leak)
      if (n.energy / C > BLACK_SATURATION) n.sat++
      else n.sat = Math.max(0, n.sat - 2)
    } else {
      if (fl < 0.05) n.starve++
      else n.starve = Math.max(0, n.starve - 3)
      if (n.starve > GREY_STARVE_TICKS) n.mass *= Math.exp(-0.06 * dt)
    }
    if (n.anchor & ANCHOR_ENERGY) {
      const target = Math.min(n.anchorEnergy, capacity(n))
      w.acct.external += target - n.energy
      n.energy = target
    }
    if (n.energy > capacity(n)) {
      const extra = n.energy - capacity(n)
      n.energy -= extra
      deposit(f.radiance, f, n.p, extra)
    }
    n.energy = Math.max(0, finite(n.energy))
    void sc
  }
}


/** Strands: phase coupling, flow of energy, tension, stress, learning, fading. */
export function strandStep(w: WorldState, env: EnvParams, dt: number, sc: StepScratch): { fractures: SimStrand[]; births: SimStrand[]; faded: SimStrand[] } {
  const fractures: SimStrand[] = []
  const births: SimStrand[] = []
  const faded: SimStrand[] = []
  const phaseOn = w.laws.phase
  const f = w.field
  const kEma = emaK(dt, 3)
  for (const s of w.strands) {
    const A = sc.byId.get(s.a)
    const B = sc.byId.get(s.b)
    if (!A || !B) continue
    const dx = B.p.x - A.p.x
    const dy = B.p.y - A.p.y
    const dz = B.p.z - A.p.z
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
    let eta = 1
    if (phaseOn) {
      const delta = wrapAngle(B.phase - A.phase - s.twist)
      const k = s.coupling * PHASE_GAIN
      const sn = Math.sin(delta)
      sc.dphase.set(A.id, (sc.dphase.get(A.id) ?? 0) + k * sn)
      sc.dphase.set(B.id, (sc.dphase.get(B.id) ?? 0) - k * sn)
      const raw = wrapAngle(delta - s.prevDelta) / dt
      s.prevDelta = delta
      s.drift += (raw - s.drift) * emaK(dt, 1.2)
      if (Math.abs(s.drift) < LOCK_RATE) s.lock++
      else s.lock = Math.max(0, s.lock - 3)
      eta = 0.55 + 0.45 * Math.cos(delta)
    } else s.lock = 0

    // Flow: a potential difference drives it; resistance resists; it has momentum.
    const Va = potential(A)
    const Vb = potential(B)
    let drive = STRAND_DRIVE * s.coupling * eta * (Va - Vb)
    if (drive > 0 && s.bias < 0) drive *= 1 + s.bias
    if (drive < 0 && s.bias > 0) drive *= 1 - s.bias
    const severed = veilBlocks(w, sc, A.id, B.id, 8)
    if (severed) drive = 0
    const strength = s.strength * env.strandStrength
    const iMax = STRAND_MAX_CURRENT_PER_STRENGTH * strength
    s.current += (dt * (drive - s.resistance * s.current * (severed ? 8 : 1))) / STRAND_INERTIA
    s.current = clamp(finite(s.current), -iMax * 1.6, iMax * 1.6)
    let q = s.current * dt
    if (q > 0) q = Math.min(q, A.energy)
    else q = Math.max(q, -B.energy)
    const lossFrac = Math.min(0.4, 0.015 * s.resistance * Math.abs(s.current))
    const lost = Math.abs(q) * lossFrac
    if (q > 0) {
      A.energy -= q
      B.energy += q - lost
    } else if (q < 0) {
      B.energy += q
      A.energy += -q - lost
    }
    const mid = { x: A.p.x + dx * 0.5, y: A.p.y + dy * 0.5, z: A.p.z + dz * 0.5 }
    if (lost > 0) deposit(f.radiance, f, mid, lost)
    s.carried = Math.abs(q) / dt

    // Measuring the flow: mean, oscillation amplitude and frequency.
    s.mean += (s.current - s.mean) * kEma
    const dev = s.current - s.mean
    s.vari += (dev * dev - s.vari) * kEma
    s.amp = Math.sqrt(Math.max(0, 2 * s.vari))
    if (s.amp > 0.12) {
      const sign = dev > 0 ? 1 : -1
      if (s.lastSign !== 0 && sign !== s.lastSign) s.crossings++
      s.lastSign = sign
    }
    s.crossTimer += dt
    if (s.crossTimer >= 3) {
      s.oscFreq += (s.crossings / (2 * s.crossTimer) - s.oscFreq) * 0.5
      s.crossings = 0
      s.crossTimer = 0
    }

    s.tension = STRAND_SPRING * s.elasticity * (len - s.rest)
    const overT = Math.max(0, Math.abs(s.tension) / (12 * strength) - 0.7) / 0.3
    const overI = Math.max(0, Math.abs(s.current) / iMax - 0.8) / 0.2
    const overA = Math.max(0, s.amp / (0.6 * iMax) - 0.8) / 0.2
    const shake = Math.max(0, vibration(f, mid) - 1.5) * 0.05
    const over = overT + overI + 0.5 * overA + shake / strength
    if (over > 0) s.stress += dt * env.stressGain * over
    else s.stress = Math.max(0, s.stress - dt * 0.15)
    s.stress = finite(s.stress)
    if (s.stress >= 1) fractures.push(s)

    if (phaseOn && !s.anchored) {
      // Connection / isolation: strands that carry energy in rhythm strengthen; idle ones fade.
      if (s.lock > 60 && Math.abs(s.mean) > 0.2) s.coupling = Math.min(2.2, s.coupling + HEBB_RATE * 10 * (1.5 - Math.min(1.5, s.coupling)) * dt)
    }
    if (Math.abs(s.current) < 0.03 && s.lock < 30) s.idle++
    else s.idle = 0
    if (s.origin === 'spontaneous' && !s.anchored && s.idle > 600) {
      s.coupling -= IDLE_DECAY * dt * 3
      if (s.coupling < 0.04) faded.push(s)
    }

    if (
      w.laws.mediators &&
      !s.birthDone &&
      s.lock >= BIRTH_LOCK_TICKS &&
      Math.abs(s.mean) >= BIRTH_MIN_FLOW &&
      ((A.kind === 'black' && B.kind === 'white') || (A.kind === 'white' && B.kind === 'black'))
    ) {
      births.push(s)
    }
  }
  return { fractures, births, faded }
}

/** Phases advance; mediators that complete a cycle with enough charge fire. */
export function phaseStep(w: WorldState, env: EnvParams, dt: number, sc: StepScratch): SimNode[] {
  const fired: SimNode[] = []
  const sq = Math.sqrt(dt)
  for (const n of w.nodes) {
    const fl = fill(n)
    const fEff = n.kind === 'grey' && w.laws.mediators ? n.freq * (0.3 + 1.4 * fl) : n.freq
    let ph = n.phase + dt * TAU * fEff
    if (w.laws.phase && !(n.anchor & ANCHOR_PHASE)) {
      ph += dt * (sc.dphase.get(n.id) ?? 0) + env.noise * sq * randNormal(w)
    }
    if (n.kind === 'grey' && w.laws.mediators && ph >= TAU && fl >= GREY_FIRE_FILL) fired.push(n)
    n.phase = wrapPhase(finite(ph))
  }
  return fired
}

export function fire(w: WorldState, g: SimNode, sc: StepScratch): void {
  const release = GREY_FIRE_RELEASE * g.energy
  if (release <= 0) return
  const mine = w.strands.filter((s) => s.a === g.id || s.b === g.id)
  const toStrands = mine.length ? 0.7 * release : 0
  const toSignal = release - toStrands
  g.energy -= release
  w.acct.converted += toSignal
  pulseField(w.field, g.p, 0.8 + release * 0.15, 4)
  g.glow = 1
  if (mine.length) {
    const share = toStrands / mine.length
    for (const s of mine) {
      const other = sc.byId.get(s.a === g.id ? s.b : s.a)
      if (!other) continue
      const room = Math.max(0, capacity(other) - other.energy)
      const give = Math.min(share, room)
      other.energy += give
      if (give < share) deposit(w.field.radiance, w.field, other.p, share - give)
      s.current += (s.a === g.id ? 1 : -1) * Math.min(4, share * 1.5)
      // Pulse coupling: a firing nudges its neighbours' rhythm forward.
      other.phase = wrapPhase(other.phase + GREY_PULSE_COUPLING * s.coupling)
    }
  }
  emit(w, 'fire', g.p, { a: g.id, value: release })
}

/** Gravity of the dark, pressure of the light, collisions, strand springs, twist drive, pulls, walls. */
export function forceStep(w: WorldState, env: EnvParams, dt: number, sc: StepScratch): void {
  const F = sc.force
  F.clear()
  for (const n of w.nodes) F.set(n.id, { x: 0, y: 0, z: 0 })
  sc.hash.build(w.nodes)
  const forcesVeiled = w.veils.some((v) => v.mask & 4)
  for (const n of w.nodes) {
    const rn = radiusOf(n)
    const fn = F.get(n.id)!
    sc.hash.query(n.p, FORCE_CUTOFF, (o, d2) => {
      if (o.id <= n.id) return
      if (forcesVeiled && veilBlocks(w, sc, n.id, o.id, 4)) return
      const d = Math.sqrt(d2) || 1e-6
      const ux = (o.p.x - n.p.x) / d
      const uy = (o.p.y - n.p.y) / d
      const uz = (o.p.z - n.p.z) / d
      let attract = 0 // positive pulls n and o together
      if (n.kind === 'black') attract += (GRAVITY * n.mass * (0.4 + fill(n)) * (n.well ? 1.8 : 1) * o.mass) / (d2 + SOFTENING * SOFTENING)
      if (o.kind === 'black') attract += (GRAVITY * o.mass * (0.4 + fill(o)) * (o.well ? 1.8 : 1) * n.mass) / (d2 + SOFTENING * SOFTENING)
      const ro = radiusOf(o)
      if (n.kind === 'white') attract -= (PRESSURE * n.mass * fill(n) * ro * ro) / (Math.pow(d, 2.2) + SOFTENING)
      if (o.kind === 'white') attract -= (PRESSURE * o.mass * fill(o) * rn * rn) / (Math.pow(d, 2.2) + SOFTENING)
      const overlap = rn + ro - d
      if (overlap > 0) {
        const rv = (o.v.x - n.v.x) * ux + (o.v.y - n.v.y) * uy + (o.v.z - n.v.z) * uz
        attract -= COLLISION_K * overlap - 2 * Math.min(0, rv)
      }
      const fo = F.get(o.id)!
      fn.x += ux * attract
      fn.y += uy * attract
      fn.z += uz * attract
      fo.x -= ux * attract
      fo.y -= uy * attract
      fo.z -= uz * attract
    })
  }
  for (const s of w.strands) {
    const A = sc.byId.get(s.a)
    const B = sc.byId.get(s.b)
    if (!A || !B) continue
    const dx = B.p.x - A.p.x
    const dy = B.p.y - A.p.y
    const dz = B.p.z - A.p.z
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
    const dir = { x: dx / len, y: dy / len, z: dz / len }
    const rv = (B.v.x - A.v.x) * dir.x + (B.v.y - A.v.y) * dir.y + (B.v.z - A.v.z) * dir.z
    const pull = s.tension + STRAND_DAMP * rv
    const fa = F.get(A.id)!
    const fb = F.get(B.id)!
    fa.x += dir.x * pull
    fa.y += dir.y * pull
    fa.z += dir.z * pull
    fb.x -= dir.x * pull
    fb.y -= dir.y * pull
    fb.z -= dir.z * pull
    // Torsion: a twisted strand carrying flow turns its ends around each other.
    const ax = s.axis
    const dot = ax.x * dir.x + ax.y * dir.y + ax.z * dir.z
    const axis = vnorm({ x: ax.x - dir.x * dot, y: ax.y - dir.y * dot, z: ax.z - dir.z * dot }, ax)
    s.axis = axis
    if (s.twist !== 0) {
      const t = vcross(axis, dir)
      const mag = TWIST_DRIVE * clamp(s.twist, -Math.PI, Math.PI) * Math.min(6, Math.abs(s.current)) * Math.min(1.5, s.coupling + 0.2)
      fa.x -= t.x * mag
      fa.y -= t.y * mag
      fa.z -= t.z * mag
      fb.x += t.x * mag
      fb.y += t.y * mag
      fb.z += t.z * mag
    }
  }
  for (const pf of w.pulls) {
    for (const n of w.nodes) {
      const dx = pf.p.x - n.p.x
      const dy = pf.p.y - n.p.y
      const dz = pf.p.z - n.p.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d > pf.r || d < 1e-6) continue
      const mag = pf.strength * 8 * n.mass * (1 - d / pf.r)
      const fn = F.get(n.id)!
      fn.x += (dx / d) * mag
      fn.y += (dy / d) * mag
      fn.z += (dz / d) * mag
    }
  }
  for (const n of w.nodes) {
    const fn = F.get(n.id)!
    boundaryForce(env, n.p, n.mass, fn)
  }
}

export function boundaryForce(env: EnvParams, p: Vec3, mass: number, out: Vec3): void {
  const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
  const R = env.radius
  if (env.gravityWell > 0 && r > 1e-6) {
    const g = env.gravityWell * mass * Math.min(1, r / 10)
    out.x -= (p.x / r) * g
    out.y -= (p.y / r) * g
    out.z -= (p.z / r) * g
  }
  const edge = env.boundary === 'reflect' ? 0.97 : 0.9
  if (r > R * edge) {
    const k = (env.boundary === 'reflect' ? 30 : 5) * (r - R * edge) * mass
    out.x -= (p.x / r) * k
    out.y -= (p.y / r) * k
    out.z -= (p.z / r) * k
  }
}

export function integrate(w: WorldState, env: EnvParams, dt: number, sc: StepScratch): void {
  const damp = Math.exp(-env.viscosity * dt)
  for (const n of w.nodes) {
    if (n.anchor & ANCHOR_POS) {
      n.v.x = n.v.y = n.v.z = 0
      continue
    }
    if (n.held && n.target) {
      // The Hand moves the node firmly but physically, so strands still stretch and react.
      const vx = clamp(((n.target.x - n.p.x) / dt) * 0.35, -60, 60)
      const vy = clamp(((n.target.y - n.p.y) / dt) * 0.35, -60, 60)
      const vz = clamp(((n.target.z - n.p.z) / dt) * 0.35, -60, 60)
      n.v = { x: vx, y: vy, z: vz }
    } else {
      const f = sc.force.get(n.id)!
      const inv = 1 / Math.max(0.1, n.mass)
      n.v.x = (n.v.x + f.x * inv * dt) * damp
      n.v.y = (n.v.y + f.y * inv * dt) * damp
      n.v.z = (n.v.z + f.z * inv * dt) * damp
      const sp = vlen(n.v)
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp
        n.v.x *= k
        n.v.y *= k
        n.v.z *= k
      }
    }
    n.p.x = finite(n.p.x + n.v.x * dt)
    n.p.y = finite(n.p.y + n.v.y * dt)
    n.p.z = finite(n.p.z + n.v.z * dt)
    n.v.x = finite(n.v.x)
    n.v.y = finite(n.v.y)
    n.v.z = finite(n.v.z)
    const R = env.radius * 1.02
    const r = vlen(n.p)
    if (r > R) {
      n.p.x *= R / r
      n.p.y *= R / r
      n.p.z *= R / r
      const radial = vdot(n.v, n.p) / R
      if (radial > 0) {
        n.v.x -= ((radial * n.p.x) / R) * (env.boundary === 'reflect' ? 2 : 1)
        n.v.y -= ((radial * n.p.y) / R) * (env.boundary === 'reflect' ? 2 : 1)
        n.v.z -= ((radial * n.p.z) / R) * (env.boundary === 'reflect' ? 2 : 1)
      }
    }
  }
}

/** Rule-governed changes of state: collapse, shatter, resonant birth, dissolution, threshold conversion. */
export function transformations(w: WorldState, env: EnvParams, sc: StepScratch, births: SimStrand[]): void {
  const collapse: SimNode[] = []
  const shatter: SimNode[] = []
  const dissolve: SimNode[] = []
  for (const n of w.nodes) {
    if (n.kind === 'black' && n.sat >= BLACK_COLLAPSE_TICKS) collapse.push(n)
    else if (n.kind === 'white' && n.sat >= WHITE_OVERLOAD_TICKS) shatter.push(n)
    else if (n.kind === 'grey' && n.mass < MASS_MIN) dissolve.push(n)
  }
  for (const n of collapse) collapseNode(w, n)
  for (const n of shatter) shatterNode(w, n)
  for (const n of dissolve) {
    deposit(w.field.radiance, w.field, n.p, n.energy)
    n.energy = 0
    removeNode(w, n.id)
    emit(w, 'dissolve', n.p, { a: n.id })
  }
  for (const s of births) resonantBirth(w, s)

  if (env.boundary === 'split') {
    const plane = thresholdPlane(env, w.envClock)
    for (const n of w.nodes) {
      if (n.kind === 'grey') continue
      if (n.p.x > plane + 2) n.zone = Math.min(n.zone + 1, 600)
      else if (n.p.x < plane - 2) n.zone = Math.max(n.zone - 1, -600)
      if (n.kind === 'black' && n.zone > 300 && fill(n) > 0.6) {
        convert(w, n, 'white')
      } else if (n.kind === 'white' && n.zone < -300 && fill(n) < 0.45) {
        convert(w, n, 'black')
      }
    }
  }
  void sc
}

function convert(w: WorldState, n: SimNode, to: 'white' | 'black'): void {
  const before = n.energy
  n.kind = to
  n.well = false
  n.zone = 0
  n.sat = 0
  n.glow = 1
  const c = capacity(n)
  if (n.energy > c) {
    deposit(w.field.radiance, w.field, n.p, n.energy - c)
    n.energy = c
  }
  emit(w, 'transform', n.p, { a: n.id, text: to, value: before })
}

export function collapseNode(w: WorldState, n: SimNode): void {
  const release = 0.45 * n.energy
  n.energy -= release
  let spawned = 0
  if (w.laws.mediators) {
    const k = clamp(Math.floor(release / 12), 1, 4)
    const each = (0.4 * release) / k
    for (let i = 0; i < k; i++) {
      if (w.nodes.length >= LIMITS.nodes) break
      const dir = randUnit(w)
      const r = radiusOf(n) + 3 + randRange(w, 0, 2)
      const g = addNode(w, 'grey', { x: n.p.x + dir.x * r, y: n.p.y + dir.y * r, z: n.p.z + dir.z * r }, {
        mass: 0.7,
        energy: 0,
        v: { x: dir.x * 3, y: dir.y * 3, z: dir.z * 3 },
        freq: clamp(n.freq * randRange(w, 1.2, 2.2), FREQ_MIN, FREQ_MAX)
      })
      if (!g) break
      g.energy = Math.min(each, capacity(g))
      deposit(w.field.radiance, w.field, g.p, each - g.energy)
      addStrand(w, n.id, g.id, { coupling: 0.4, origin: 'collapse', resistance: 1 })
      spawned++
    }
    const used = spawned * each
    deposit(w.field.radiance, w.field, n.p, release - used)
  } else {
    deposit(w.field.radiance, w.field, n.p, release)
  }
  n.well = true
  n.mass = Math.min(MASS_MAX, n.mass * (spawned ? 1.35 : 1.15))
  n.sat = 0
  n.glow = 1
  pulseField(w.field, n.p, 4 + release * 0.05, 6)
  w.stats.collapses++
  invalidate(w)
  emit(w, 'collapse', n.p, { a: n.id, value: release, b: spawned })
}

export function shatterNode(w: WorldState, n: SimNode): void {
  const pieces = n.mass > 1.6 ? 3 : 2
  const m = n.mass / pieces
  const e = n.energy / pieces
  n.mass = Math.max(MASS_MIN, m)
  n.energy = Math.min(e, capacity(n))
  let extra = e - n.energy
  n.sat = 0
  n.glow = 1
  for (let i = 1; i < pieces; i++) {
    const dir = randUnit(w)
    const piece = addNode(w, 'white', { x: n.p.x + dir.x * 2.5, y: n.p.y + dir.y * 2.5, z: n.p.z + dir.z * 2.5 }, {
      mass: Math.max(MASS_MIN, m),
      energy: 0,
      v: { x: dir.x * 6, y: dir.y * 6, z: dir.z * 6 },
      freq: n.freq * randRange(w, 0.9, 1.1)
    })
    if (!piece) {
      extra += e
      continue
    }
    piece.energy = Math.min(e, capacity(piece))
    extra += e - piece.energy
  }
  if (extra > 0) deposit(w.field.radiance, w.field, n.p, extra)
  pulseField(w.field, n.p, 3, 5)
  emit(w, 'shatter', n.p, { a: n.id, value: pieces })
}

export function resonantBirth(w: WorldState, s: SimStrand): void {
  if (w.nodes.length >= LIMITS.nodes) {
    s.birthDone = true
    return
  }
  const A = w.nodes.find((n) => n.id === s.a)
  const B = w.nodes.find((n) => n.id === s.b)
  if (!A || !B || !w.strands.includes(s)) return
  const mid = { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2, z: (A.p.z + B.p.z) / 2 }
  const ph = Math.atan2(Math.sin(A.phase) + Math.sin(B.phase), Math.cos(A.phase) + Math.cos(B.phase))
  const g = addNode(w, 'grey', mid, { mass: 0.7, energy: 0, freq: (A.freq + B.freq) / 2, phase: wrapPhase(ph) })
  if (!g) return
  const take = Math.min(3, A.energy * 0.5) + Math.min(3, B.energy * 0.5)
  const ta = Math.min(3, A.energy * 0.5)
  A.energy -= ta
  B.energy -= take - ta
  g.energy = Math.min(take, capacity(g))
  if (take > g.energy) deposit(w.field.radiance, w.field, mid, take - g.energy)
  g.glow = 1
  const len = Math.sqrt((A.p.x - B.p.x) ** 2 + (A.p.y - B.p.y) ** 2 + (A.p.z - B.p.z) ** 2)
  removeStrand(w, s.id)
  const o = { coupling: s.coupling, resistance: s.resistance, twist: s.twist / 2, elasticity: s.elasticity, rest: Math.max(2, len / 2), origin: 'birth' as const, strength: s.strength }
  addStrand(w, A.id, g.id, o)
  addStrand(w, g.id, B.id, o)
  w.stats.births++
  pulseField(w.field, mid, 2.5, 4)
  emit(w, 'birth', mid, { a: g.id, b: s.id })
}

export function fractureStrand(w: WorldState, s: SimStrand, sc: StepScratch | null, cause: 'stress' | 'cut' = 'stress'): void {
  const A = sc?.byId.get(s.a) ?? w.nodes.find((n) => n.id === s.a)
  const B = sc?.byId.get(s.b) ?? w.nodes.find((n) => n.id === s.b)
  removeStrand(w, s.id)
  if (!A || !B) return
  const mid = { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2, z: (A.p.z + B.p.z) / 2 }
  const ra = A.energy * 0.12
  const rb = B.energy * 0.12
  A.energy -= ra
  B.energy -= rb
  deposit(w.field.radiance, w.field, mid, ra + rb)
  pulseField(w.field, mid, 1.5 + 0.3 * Math.abs(s.current) + 0.08 * Math.abs(s.tension), 4)
  const dx = B.p.x - A.p.x
  const dy = B.p.y - A.p.y
  const dz = B.p.z - A.p.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const recoil = clamp(Math.abs(s.tension) * 0.3, 0.5, 12)
  if (!(A.anchor & ANCHOR_POS) && !A.held) {
    A.v.x -= ((dx / len) * recoil) / A.mass
    A.v.y -= ((dy / len) * recoil) / A.mass
    A.v.z -= ((dz / len) * recoil) / A.mass
  }
  if (!(B.anchor & ANCHOR_POS) && !B.held) {
    B.v.x += ((dx / len) * recoil) / B.mass
    B.v.y += ((dy / len) * recoil) / B.mass
    B.v.z += ((dz / len) * recoil) / B.mass
  }
  A.glow = Math.max(A.glow, 0.7)
  B.glow = Math.max(B.glow, 0.7)
  w.stats.fractures++
  if (w.scars.length < 200) w.scars.push({ a: s.a, b: s.b, t: w.tick, rest: s.rest })
  emit(w, cause === 'cut' ? 'cut' : 'fracture', mid, { a: s.a, b: s.b, value: ra + rb, text: String(s.id) })
}

/** Strands form on their own between close, compatible, or rhythm-aligned concentrations. */
export function spontaneousStrands(w: WorldState, env: EnvParams, sc: StepScratch): void {
  if (w.tick % 5 !== 0) return
  let made = 0
  const deg = new Map<number, number>()
  const pairs = new Set<string>()
  for (const s of w.strands) {
    deg.set(s.a, (deg.get(s.a) ?? 0) + 1)
    deg.set(s.b, (deg.get(s.b) ?? 0) + 1)
    pairs.add(s.a < s.b ? `${s.a}:${s.b}` : `${s.b}:${s.a}`)
  }
  for (const n of w.nodes) {
    if (made >= 3 || w.strands.length >= LIMITS.strands) break
    if ((deg.get(n.id) ?? 0) >= STRAND_MAX_PER_NODE - 1) continue
    sc.hash.query(n.p, env.formDist, (o, d2) => {
      if (made >= 3 || o.id <= n.id) return
      if ((deg.get(o.id) ?? 0) >= STRAND_MAX_PER_NODE - 1) return
      const key = `${n.id}:${o.id}`
      if (pairs.has(key)) return
      if (veilBlocks(w, sc, n.id, o.id, 8)) return
      let aff = 0
      if ((n.kind === 'black' && o.kind === 'white') || (n.kind === 'white' && o.kind === 'black')) aff = 1
      else if (n.kind === 'grey' || o.kind === 'grey') aff = w.laws.mediators ? 0.7 : 0
      else aff = w.laws.phase ? 0.5 * Math.pow(Math.max(0, Math.cos(n.phase - o.phase)), 4) : 0.15
      const d = Math.sqrt(d2)
      const p = env.formRate * aff * (1 - d / env.formDist)
      if (p > 0 && nextRandom(w) < p) {
        const s = addStrand(w, n.id, o.id, { coupling: 0.12, resistance: 1.2, rest: d * 0.95, elasticity: 0.4, strength: 0.6, origin: 'spontaneous' })
        if (s) {
          made++
          pairs.add(key)
          deg.set(n.id, (deg.get(n.id) ?? 0) + 1)
          deg.set(o.id, (deg.get(o.id) ?? 0) + 1)
          emit(w, 'strandFormed', { x: (n.p.x + o.p.x) / 2, y: (n.p.y + o.p.y) / 2, z: (n.p.z + o.p.z) / 2 }, { a: n.id, b: o.id, text: String(s.id) })
        }
      }
    })
  }
  // Fracture Garden: broken strands grow back if their ends are still near.
  if (env.regrowth && w.scars.length) {
    const keep: typeof w.scars = []
    for (const sc2 of w.scars) {
      const age = w.tick - sc2.t
      const A = sc.byId.get(sc2.a)
      const B = sc.byId.get(sc2.b)
      if (!A || !B || age > 1800) continue
      if (age > 300) {
        const d = Math.sqrt((A.p.x - B.p.x) ** 2 + (A.p.y - B.p.y) ** 2 + (A.p.z - B.p.z) ** 2)
        if (d < sc2.rest * 1.6 && (deg.get(A.id) ?? 0) < STRAND_MAX_PER_NODE && (deg.get(B.id) ?? 0) < STRAND_MAX_PER_NODE && !pairs.has(A.id < B.id ? `${A.id}:${B.id}` : `${B.id}:${A.id}`)) {
          const s = addStrand(w, A.id, B.id, { coupling: 0.25, resistance: 1.2, rest: sc2.rest, strength: 0.8, origin: 'regrowth' })
          if (s) {
            emit(w, 'regrowth', { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2, z: (A.p.z + B.p.z) / 2 }, { a: A.id, b: B.id })
            continue
          }
        }
      }
      keep.push(sc2)
    }
    w.scars = keep
  }
}

export function fieldCellOf(w: WorldState, p: Vec3): number {
  return cellOf(w.field, p)
}
