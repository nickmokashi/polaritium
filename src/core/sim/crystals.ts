import { CRYSTAL_MAX_DEPTH, CRYSTAL_MAX_SEGS, CRYSTAL_SEG_LEN, LIMITS } from './constants'
import type { EnvParams } from './environments'
import { deposit, gradient, sample, vibration, withdraw } from './field'
import { TAU, clamp, emaK, vlen, vnorm, type Vec3 } from './math'
import { nextRandom, randRange, randUnit } from './rng'
import type { Crystal, Fragment, Habit, Seg, SimNode, WorldState } from './types'
import { capacity, emit, fill, newId } from './world'

// Crystalline forms grow along energy gradients in still places, along their own lattice.
// They drink radiance, store it, give an overfull dark node somewhere to put its energy,
// and break when shaken at their own frequency.

const S2 = Math.SQRT1_2
const DIRS: Record<Habit, Vec3[]> = {
  cubic: [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: S2, y: S2, z: 0 },
    { x: -S2, y: S2, z: 0 },
    { x: 0, y: S2, z: S2 },
    { x: 0, y: S2, z: -S2 },
    { x: S2, y: -S2, z: 0 },
    { x: -S2, y: -S2, z: 0 },
    { x: 0, y: -S2, z: S2 },
    { x: 0, y: -S2, z: -S2 },
    { x: S2, y: 0, z: S2 },
    { x: -S2, y: 0, z: S2 },
    { x: S2, y: 0, z: -S2 },
    { x: -S2, y: 0, z: -S2 }
  ],
  hex: [
    ...Array.from({ length: 6 }, (_, i) => ({ x: Math.cos((i * TAU) / 6), y: 0, z: Math.sin((i * TAU) / 6) })),
    ...Array.from({ length: 6 }, (_, i) => ({ x: Math.cos((i * TAU) / 6) * S2, y: S2, z: Math.sin((i * TAU) / 6) * S2 })),
    ...Array.from({ length: 6 }, (_, i) => ({ x: Math.cos((i * TAU) / 6) * S2, y: -S2, z: Math.sin((i * TAU) / 6) * S2 })),
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }
  ],
  spire: [
    { x: 0, y: 1, z: 0 },
    ...Array.from({ length: 6 }, (_, i) => {
      const t = 0.26
      return { x: Math.cos((i * TAU) / 6) * Math.sin(t), y: Math.cos(t), z: Math.sin((i * TAU) / 6) * Math.sin(t) }
    }),
    ...Array.from({ length: 6 }, (_, i) => {
      const t = 0.7
      return { x: Math.cos((i * TAU) / 6 + 0.5) * Math.sin(t), y: Math.cos(t), z: Math.sin((i * TAU) / 6 + 0.5) * Math.sin(t) }
    })
  ],
  shard: (() => {
    const g = (1 + Math.sqrt(5)) / 2
    const v: Vec3[] = []
    for (const a of [-1, 1]) for (const b of [-g, g]) v.push(vnorm({ x: 0, y: a, z: b }), vnorm({ x: a, y: b, z: 0 }), vnorm({ x: b, y: 0, z: a }))
    return v
  })()
}

function rotate(b: number[], d: Vec3): Vec3 {
  return { x: b[0] * d.x + b[1] * d.y + b[2] * d.z, y: b[3] * d.x + b[4] * d.y + b[5] * d.z, z: b[6] * d.x + b[7] * d.y + b[8] * d.z }
}

function yawBasis(a: number, tilt: number): number[] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const ct = Math.cos(tilt)
  const st = Math.sin(tilt)
  // yaw about y, then a small tilt about x
  return [c, s * st, s * ct, 0, ct, -st, -s, c * st, c * ct]
}

function snap(c: Crystal, desired: Vec3, exclude?: Vec3): Vec3 {
  let best: Vec3 | null = null
  let bd = -Infinity
  for (const d of DIRS[c.habit]) {
    const wd = rotate(c.basis, d)
    let score = wd.x * desired.x + wd.y * desired.y + wd.z * desired.z
    if (exclude) {
      const ex = wd.x * exclude.x + wd.y * exclude.y + wd.z * exclude.z
      if (ex > 0.97) score -= 3
    }
    if (score > bd) {
      bd = score
      best = wd
    }
  }
  return best ?? desired
}

function branchDir(w: WorldState, c: Crystal, parent: Vec3): Vec3 {
  const opts: Vec3[] = []
  for (const d of DIRS[c.habit]) {
    const wd = rotate(c.basis, d)
    const dot = wd.x * parent.x + wd.y * parent.y + wd.z * parent.z
    if (dot > -0.35 && dot < 0.9) opts.push(wd)
  }
  if (!opts.length) return parent
  return opts[Math.floor(nextRandom(w) * opts.length)]
}

export function crystalSegmentCount(w: WorldState): number {
  let n = 0
  for (const c of w.crystals) n += c.segs.length
  return n
}

export function nucleate(w: WorldState, env: EnvParams, at: Vec3, anchor: SimNode | null, habitHint?: Habit): Crystal | null {
  if (w.crystals.length >= LIMITS.crystals || crystalSegmentCount(w) >= LIMITS.crystalSegments) return null
  const habit: Habit =
    habitHint ?? (env.id === 'cathedral' ? 'spire' : env.id === 'garden' ? 'shard' : env.id === 'well' ? 'cubic' : nextRandom(w) < 0.5 ? 'hex' : 'cubic')
  const c: Crystal = {
    id: newId(w),
    anchor: anchor ? anchor.id : -1,
    origin: anchor ? { ...anchor.p } : { ...at },
    habit,
    basis: yawBasis(randRange(w, 0, TAU), randRange(w, -0.25, 0.25)),
    freq: randRange(w, 0.3, 1.4),
    segs: [],
    energy: 0,
    iq: 0,
    qq: 0,
    vibMean: 0,
    resonance: 0,
    age: 0,
    name: null,
    born: w.tick,
    peak: 0,
    regrowFrom: 0
  }
  const g = gradient(w.field.radiance, w.field, at)
  const dir = snap(c, vlen(g) > 1e-4 ? vnorm(g) : randUnit(w))
  const start = anchor ? { x: at.x + dir.x * 1.2, y: at.y + dir.y * 1.2, z: at.z + dir.z * 1.2 } : at
  c.segs.push(makeSeg(start, dir, -1, 0, 0.42))
  w.crystals.push(c)
  emit(w, 'crystal', at, { a: c.id, text: habit })
  return c
}

function makeSeg(a: Vec3, d: Vec3, parent: number, depth: number, thick: number): Seg {
  return { ax: a.x, ay: a.y, az: a.z, bx: a.x, by: a.y, bz: a.z, dx: d.x, dy: d.y, dz: d.z, len: 0, parent, depth, thick, stress: 0, growing: true, children: 0 }
}

export function crystalLength(c: Crystal): number {
  let s = 0
  for (const g of c.segs) s += g.len
  return s
}

export function crystalStep(w: WorldState, env: EnvParams, dt: number, byId: Map<number, SimNode>): void {
  const f = w.field
  // Nucleation near dark concentrations in stillness.
  if (w.laws.crystals && w.tick % 30 === 0) {
    for (const n of w.nodes) {
      if (n.kind !== 'black') continue
      if (w.crystals.some((c) => c.anchor === n.id)) continue
      if (fill(n) < 0.3 || vlen(n.v) > 0.6) continue
      if (vibration(f, n.p) > env.stillnessLimit) continue
      const g = vlen(gradient(f.radiance, f, n.p))
      const p = env.crystalNucleation * Math.min(1, g * 4 + 0.1)
      if (nextRandom(w) < p) nucleate(w, env, n.p, n)
    }
  }

  const kq = emaK(dt, 3)
  const total = crystalSegmentCount(w)
  let budget = LIMITS.crystalSegments - total
  for (const c of w.crystals) {
    c.age++
    const anchor = c.anchor >= 0 ? byId.get(c.anchor) : undefined
    if (anchor) {
      const ddx = anchor.p.x - c.origin.x
      const ddy = anchor.p.y - c.origin.y
      const ddz = anchor.p.z - c.origin.z
      if (ddx !== 0 || ddy !== 0 || ddz !== 0) {
        for (const s of c.segs) {
          s.ax += ddx
          s.ay += ddy
          s.az += ddz
          s.bx += ddx
          s.by += ddy
          s.bz += ddz
        }
        c.origin = { ...anchor.p }
      }
      // A crystal gives an overfull dark node somewhere to put its energy.
      const fl = fill(anchor)
      if (fl > 0.85 && c.segs.length) {
        const room = c.segs.length * 4 - c.energy
        const take = Math.min(anchor.energy - capacity(anchor) * 0.85, 0.6 * dt * Math.min(20, c.segs.length), Math.max(0, room))
        if (take > 0) {
          anchor.energy -= take
          c.energy += take
        }
      }
    }
    // Lock-in detection of vibration at the crystal's own frequency.
    const centre = c.segs.length ? { x: c.segs[0].ax, y: c.segs[0].ay, z: c.segs[0].az } : c.origin
    // Remove the steady part of the shaking, then measure what is left at the crystal's own frequency.
    const vibC = vibration(f, centre)
    c.vibMean += (vibC - c.vibMean) * emaK(dt, 4)
    const x = vibC - c.vibMean
    const ang = TAU * c.freq * w.tick * dt
    c.iq += (x * Math.cos(ang) - c.iq) * kq
    c.qq += (x * Math.sin(ang) - c.qq) * kq
    c.resonance = 2 * Math.sqrt(c.iq * c.iq + c.qq * c.qq)

    const broken: number[] = []
    const grow = w.tick % 3 === 0 && w.laws.crystals
    const dt3 = dt * 3
    const n0 = c.segs.length
    for (let i = 0; i < n0; i++) {
      const s = c.segs[i]
      const tip = { x: s.bx, y: s.by, z: s.bz }
      const vib = vibration(f, tip)
      s.stress += (dt * (c.resonance * 2.5 + Math.max(0, vib - env.stillnessLimit * 3) * 0.3)) / Math.max(0.2, s.thick * 2)
      s.stress = Math.max(0, s.stress - dt * 0.05)
      if (s.stress >= 1) broken.push(i)
      if (!grow || !s.growing) continue
      const R = sample(f.radiance, f, tip)
      const still = clamp(1 - vib / env.stillnessLimit, 0, 1)
      // Each generation of growth is weaker than the last, so a crystal reaches a natural size
      // instead of racing toward the light that feeds it.
      const vigour = 1 - s.depth / (CRYSTAL_MAX_DEPTH + 2)
      const rate = env.crystalGrowth * (R / (R + 1)) * still * 1.8 * vigour
      if (rate <= 0.001) continue
      const want = rate * dt3 * 0.6
      const got = withdraw(f.radiance, f, tip, want)
      const grown = want > 0 ? rate * dt3 * (got / want) : 0
      c.energy += got
      s.len += grown
      s.bx = s.ax + s.dx * s.len
      s.by = s.ay + s.dy * s.len
      s.bz = s.az + s.dz * s.len
      const r = Math.sqrt(s.bx * s.bx + s.by * s.by + s.bz * s.bz)
      if (r > env.radius * 0.97) s.growing = false
      if (s.len >= CRYSTAL_SEG_LEN) {
        s.growing = false
        if (s.depth >= CRYSTAL_MAX_DEPTH || c.segs.length >= CRYSTAL_MAX_SEGS || budget <= 0) continue
        const g = gradient(f.radiance, f, tip)
        const gl = vlen(g)
        const parent = { x: s.dx, y: s.dy, z: s.dz }
        const want2 = gl > 1e-4 ? vnorm({ x: parent.x * 0.8 + (g.x / gl) * 0.45, y: parent.y * 0.8 + (g.y / gl) * 0.45, z: parent.z * 0.8 + (g.z / gl) * 0.45 }) : parent
        const cont = snap(c, want2)
        c.segs.push(makeSeg(tip, cont, i, s.depth + 1, s.thick * 0.84))
        s.children++
        budget--
        const bp = ({ cubic: 0.32, hex: 0.3, spire: 0.12, shard: 0.22 }[c.habit] + Math.min(0.3, gl * 2)) * (1 - (s.depth / CRYSTAL_MAX_DEPTH) * 0.5)
        if (budget > 0 && c.segs.length < CRYSTAL_MAX_SEGS && nextRandom(w) < bp) {
          c.segs.push(makeSeg(tip, branchDir(w, c, parent), i, s.depth + 1, s.thick * 0.7))
          s.children++
          budget--
        }
      }
    }
    if (broken.length) breakSegments(w, env, c, broken)
    c.peak = Math.max(c.peak, c.segs.length)
  }
  // Crystals with nothing left are gone.
  for (let i = w.crystals.length - 1; i >= 0; i--) {
    const c = w.crystals[i]
    if (!c.segs.length) {
      if (c.energy > 0) deposit(f.radiance, f, c.origin, c.energy)
      w.crystals.splice(i, 1)
    }
  }
  fragmentStep(w, env, dt)
}

/** Breaks segments and everything that grew from them; the pieces become drifting shards. */
export function breakSegments(w: WorldState, env: EnvParams, c: Crystal, roots: number[]): number {
  const remove = new Set<number>()
  for (const r of roots) remove.add(r)
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < c.segs.length; i++) {
      if (!remove.has(i) && remove.has(c.segs[i].parent)) {
        remove.add(i)
        changed = true
      }
    }
  }
  if (!remove.size) return 0
  const totalLen = crystalLength(c) || 1
  let lostLen = 0
  for (const i of remove) lostLen += c.segs[i].len
  const share = c.energy * (lostLen / totalLen)
  c.energy -= share
  const rootsOnly = [...remove].filter((i) => !remove.has(c.segs[i].parent))
  const per = share / Math.max(1, rootsOnly.length)
  for (const i of rootsOnly) {
    const s = c.segs[i]
    const mid = { x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2, z: (s.az + s.bz) / 2 }
    if (w.fragments.length < LIMITS.fragments) {
      const dir = randUnit(w)
      const fr: Fragment = { id: newId(w), p: mid, v: { x: dir.x * 2, y: dir.y * 2, z: dir.z * 2 }, energy: per, habit: c.habit, age: 0, freq: c.freq }
      w.fragments.push(fr)
    } else deposit(w.field.radiance, w.field, mid, per)
    emit(w, 'crystalBreak', mid, { a: c.id, value: per })
  }
  // Rebuild the segment list with parent indices remapped.
  const map = new Map<number, number>()
  const keep: Seg[] = []
  for (let i = 0; i < c.segs.length; i++) {
    if (remove.has(i)) continue
    map.set(i, keep.length)
    keep.push(c.segs[i])
  }
  for (const s of keep) {
    s.parent = s.parent >= 0 ? (map.get(s.parent) ?? -1) : -1
    s.children = 0
  }
  for (const s of keep) if (s.parent >= 0) keep[s.parent].children++
  // A broken branch tip can grow again.
  for (const s of keep) if (s.children === 0 && s.depth < CRYSTAL_MAX_DEPTH) s.growing = s.len < CRYSTAL_SEG_LEN || env.regrowth
  c.segs = keep
  return remove.size
}

function fragmentStep(w: WorldState, env: EnvParams, dt: number): void {
  const f = w.field
  const damp = Math.exp(-Math.max(0.4, env.viscosity) * dt)
  for (let i = w.fragments.length - 1; i >= 0; i--) {
    const fr = w.fragments[i]
    fr.age++
    fr.p.x += fr.v.x * dt
    fr.p.y += fr.v.y * dt
    fr.p.z += fr.v.z * dt
    fr.v.x *= damp
    fr.v.y *= damp
    fr.v.z *= damp
    const speed = vlen(fr.v)
    if (env.regrowth && w.laws.crystals && fr.age > 90 && speed < 0.5 && vibration(f, fr.p) < env.stillnessLimit && sample(f.radiance, f, fr.p) > 0.3) {
      const c = nucleate(w, env, fr.p, null, fr.habit)
      if (c) {
        c.energy += fr.energy
        c.freq = fr.freq * randRange(w, 0.85, 1.15)
        c.regrowFrom = 1
        w.fragments.splice(i, 1)
        emit(w, 'regrowth', fr.p, { a: c.id, text: 'crystal' })
        continue
      }
    }
    if (fr.age > 600) {
      deposit(f.radiance, f, fr.p, fr.energy)
      w.fragments.splice(i, 1)
    }
  }
}

/** Grows a crystal instantly to about `count` segments (used by chambers and presets). */
export function growInstant(w: WorldState, c: Crystal, count: number): void {
  let guard = 0
  while (c.segs.length < count && guard++ < count * 6) {
    const tips = c.segs.map((s, i) => [s, i] as const).filter(([s]) => s.children === 0 && s.depth < CRYSTAL_MAX_DEPTH)
    if (!tips.length) break
    const [s, i] = tips[Math.floor(nextRandom(w) * tips.length)]
    if (s.len < CRYSTAL_SEG_LEN) {
      s.len = CRYSTAL_SEG_LEN
      s.bx = s.ax + s.dx * s.len
      s.by = s.ay + s.dy * s.len
      s.bz = s.az + s.dz * s.len
    }
    s.growing = false
    const tip = { x: s.bx, y: s.by, z: s.bz }
    const parent = { x: s.dx, y: s.dy, z: s.dz }
    const cont = snap(c, parent)
    c.segs.push(makeSeg(tip, cont, i, s.depth + 1, s.thick * 0.86))
    s.children++
    if (nextRandom(w) < 0.45) {
      c.segs.push(makeSeg(tip, branchDir(w, c, parent), i, s.depth + 1, s.thick * 0.72))
      s.children++
    }
  }
  for (const s of c.segs) {
    if (s.len < CRYSTAL_SEG_LEN) {
      s.len = CRYSTAL_SEG_LEN
      s.bx = s.ax + s.dx * s.len
      s.by = s.ay + s.dy * s.len
      s.bz = s.az + s.dz * s.len
    }
    s.growing = s.children === 0
  }
  c.peak = Math.max(c.peak, c.segs.length)
}
