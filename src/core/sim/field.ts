import type { Vec3 } from './math'
import type { EnvParams } from './environments'
import { thresholdPlane } from './environments'
import type { WorldState } from './types'

// Two fields fill the chamber on a coarse 3D grid:
//   radiance — energy that white emits into space; it spreads (diffusion), fades (decay)
//              and is drunk by black, crystals and light-eating organisms.
//   signal   — a damped wave: pulses, firings, fractures and quakes travel through it,
//              reflect off walls in the Cathedral, and shake whatever they reach.
// Explicit schemes, with step sizes kept inside their stability limits (checked in tests).

export type Field = WorldState['field']

export function makeField(n: number, half: number): Field {
  const c = n * n * n
  return { n, half, radiance: new Float64Array(c), signal: new Float32Array(c), signalVel: new Float32Array(c) }
}

export const cellSize = (f: Field): number => (2 * f.half) / f.n

export function cellOf(f: Field, p: Vec3): number {
  const dx = cellSize(f)
  const i = Math.floor((p.x + f.half) / dx)
  const j = Math.floor((p.y + f.half) / dx)
  const k = Math.floor((p.z + f.half) / dx)
  if (i < 0 || j < 0 || k < 0 || i >= f.n || j >= f.n || k >= f.n) return -1
  return i + f.n * (j + f.n * k)
}

export function cellCenter(f: Field, idx: number): Vec3 {
  const n = f.n
  const i = idx % n
  const j = Math.floor(idx / n) % n
  const k = Math.floor(idx / (n * n))
  const dx = cellSize(f)
  return { x: -f.half + (i + 0.5) * dx, y: -f.half + (j + 0.5) * dx, z: -f.half + (k + 0.5) * dx }
}

interface Tri {
  i: number[]
  w: number[]
}

const triScratch: Tri = { i: [0, 0, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0, 0] }

function trilinear(f: Field, p: Vec3, out: Tri): number {
  const dx = cellSize(f)
  const n = f.n
  let fx = (p.x + f.half) / dx - 0.5
  let fy = (p.y + f.half) / dx - 0.5
  let fz = (p.z + f.half) / dx - 0.5
  fx = Math.min(Math.max(fx, 0), n - 1.0001)
  fy = Math.min(Math.max(fy, 0), n - 1.0001)
  fz = Math.min(Math.max(fz, 0), n - 1.0001)
  const i0 = Math.floor(fx)
  const j0 = Math.floor(fy)
  const k0 = Math.floor(fz)
  const tx = fx - i0
  const ty = fy - j0
  const tz = fz - k0
  const i1 = Math.min(i0 + 1, n - 1)
  const j1 = Math.min(j0 + 1, n - 1)
  const k1 = Math.min(k0 + 1, n - 1)
  const ux = 1 - tx
  const uy = 1 - ty
  const uz = 1 - tz
  const r00 = n * (j0 + n * k0)
  const r10 = n * (j1 + n * k0)
  const r01 = n * (j0 + n * k1)
  const r11 = n * (j1 + n * k1)
  const I = out.i
  const W = out.w
  I[0] = i0 + r00; W[0] = ux * uy * uz
  I[1] = i1 + r00; W[1] = tx * uy * uz
  I[2] = i0 + r10; W[2] = ux * ty * uz
  I[3] = i1 + r10; W[3] = tx * ty * uz
  I[4] = i0 + r01; W[4] = ux * uy * tz
  I[5] = i1 + r01; W[5] = tx * uy * tz
  I[6] = i0 + r11; W[6] = ux * ty * tz
  I[7] = i1 + r11; W[7] = tx * ty * tz
  return 8
}

export function sample(arr: Float32Array | Float64Array, f: Field, p: Vec3): number {
  const t = triScratch
  trilinear(f, p, t)
  let s = 0
  for (let c = 0; c < 8; c++) s += arr[t.i[c]] * t.w[c]
  return s
}

/** Adds an amount into the field around p (conserving the total exactly). */
export function deposit(arr: Float32Array | Float64Array, f: Field, p: Vec3, amount: number): void {
  if (!(amount > 0)) return
  const t = triScratch
  trilinear(f, p, t)
  for (let c = 0; c < 8; c++) arr[t.i[c]] += amount * t.w[c]
}

/** Takes up to `want` from the field around p. Returns what was actually taken. */
export function withdraw(arr: Float32Array | Float64Array, f: Field, p: Vec3, want: number): number {
  if (!(want > 0)) return 0
  const t = triScratch
  trilinear(f, p, t)
  let avail = 0
  for (let c = 0; c < 8; c++) avail += Math.max(0, arr[t.i[c]]) * t.w[c]
  if (avail <= 1e-9) return 0
  const take = Math.min(want, avail * 0.9)
  const frac = take / avail
  let taken = 0
  for (let c = 0; c < 8; c++) {
    const idx = t.i[c]
    const d = Math.max(0, arr[idx]) * t.w[c] * frac
    arr[idx] -= d
    taken += d
  }
  return taken
}

/** Adds an impulse to the signal field: a Gaussian bump in velocity around p. */
export function pulseField(f: Field, p: Vec3, strength: number, radius: number): void {
  const dx = cellSize(f)
  const n = f.n
  const r = Math.max(radius, dx * 0.8)
  const ci = Math.floor((p.x + f.half) / dx)
  const cj = Math.floor((p.y + f.half) / dx)
  const ck = Math.floor((p.z + f.half) / dx)
  const span = Math.ceil((r * 2) / dx)
  for (let k = ck - span; k <= ck + span; k++) {
    if (k < 0 || k >= n) continue
    for (let j = cj - span; j <= cj + span; j++) {
      if (j < 0 || j >= n) continue
      for (let i = ci - span; i <= ci + span; i++) {
        if (i < 0 || i >= n) continue
        const cx = -f.half + (i + 0.5) * dx - p.x
        const cy = -f.half + (j + 0.5) * dx - p.y
        const cz = -f.half + (k + 0.5) * dx - p.z
        const d2 = cx * cx + cy * cy + cz * cz
        const g = Math.exp(-d2 / (r * r))
        if (g < 0.01) continue
        f.signalVel[i + n * (j + n * k)] += strength * g
      }
    }
  }
}

export function gradient(arr: Float32Array | Float64Array, f: Field, p: Vec3): Vec3 {
  const h = cellSize(f) * 0.75
  return {
    x: (sample(arr, f, { x: p.x + h, y: p.y, z: p.z }) - sample(arr, f, { x: p.x - h, y: p.y, z: p.z })) / (2 * h),
    y: (sample(arr, f, { x: p.x, y: p.y + h, z: p.z }) - sample(arr, f, { x: p.x, y: p.y - h, z: p.z })) / (2 * h),
    z: (sample(arr, f, { x: p.x, y: p.y, z: p.z + h }) - sample(arr, f, { x: p.x, y: p.y, z: p.z - h })) / (2 * h)
  }
}

export function total(arr: Float32Array | Float64Array): number {
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]
  return s
}

let tmp: Float64Array | null = null
let veilMask: Uint8Array | null = null

/** Which veil (1-based) each cell lies in, or 0. Null when there are no veils. */
export function computeVeilMask(w: WorldState): Uint8Array | null {
  const f = w.field
  if (!w.veils.length) return null
  const c = f.n * f.n * f.n
  if (!veilMask || veilMask.length !== c) veilMask = new Uint8Array(c)
  veilMask.fill(0)
  for (let idx = 0; idx < c; idx++) {
    const cc = cellCenter(f, idx)
    for (let v = 0; v < w.veils.length; v++) {
      const ve = w.veils[v]
      const dx = cc.x - ve.p.x
      const dy = cc.y - ve.p.y
      const dz = cc.z - ve.p.z
      if (dx * dx + dy * dy + dz * dz <= ve.r * ve.r) {
        veilMask[idx] = v + 1
        break
      }
    }
  }
  return veilMask
}

/** One step of both fields. Updates the energy accounting for sources and losses. */
export function stepField(w: WorldState, env: EnvParams, dt: number, mask: Uint8Array | null): void {
  const f = w.field
  const n = f.n
  const c = n * n * n
  const dx = cellSize(f)
  const R = f.radiance
  if (!tmp || tmp.length !== c) tmp = new Float64Array(c)
  const T = tmp
  const alpha = Math.min((env.radianceDiffusion * dt) / (dx * dx), 1 / 6.5)
  const decay = env.radianceDecay * dt
  const blockRad = (a: number, b: number) => mask !== null && mask[a] !== mask[b] && hasFlag(w, mask[a] || mask[b], 1)
  let generated = 0
  let dissipated = 0

  // Threshold: a bright half that pours radiance in and a dark half that drinks it.
  const plane = env.boundary === 'split' ? thresholdPlane(env, w.envClock) : 0
  const nn = n * n
  for (let idx = 0; idx < c; idx++) {
    const i = idx % n
    const j = Math.floor(idx / n) % n
    const k = Math.floor(idx / nn)
    const r = R[idx]
    let lap = 0
    if (i > 0 && !blockRad(idx, idx - 1)) lap += R[idx - 1] - r
    if (i < n - 1 && !blockRad(idx, idx + 1)) lap += R[idx + 1] - r
    if (j > 0 && !blockRad(idx, idx - n)) lap += R[idx - n] - r
    if (j < n - 1 && !blockRad(idx, idx + n)) lap += R[idx + n] - r
    if (k > 0 && !blockRad(idx, idx - nn)) lap += R[idx - nn] - r
    if (k < n - 1 && !blockRad(idx, idx + nn)) lap += R[idx + nn] - r
    let v = r + alpha * lap
    let loss = v * decay
    if (env.boundary === 'absorb' && (i === 0 || j === 0 || k === 0 || i === n - 1 || j === n - 1 || k === n - 1)) loss += v * 0.5 * dt
    if (env.boundary === 'split') {
      const cx = -f.half + (i + 0.5) * dx
      if (cx > plane) {
        const add = 0.6 * dt
        v += add
        generated += add
      } else loss += v * 0.25 * dt
    } else if (env.ambient > 0) {
      const add = env.ambient * dt
      v += add
      generated += add
    }
    loss = Math.min(loss, Math.max(0, v))
    v -= loss
    dissipated += loss
    if (!(v >= 0)) v = 0
    if (v > 400) {
      dissipated += v - 400
      v = 400
    }
    T[idx] = v
  }
  R.set(T)
  w.acct.generated += generated
  w.acct.dissipated += dissipated

  // Signal: damped wave equation, symplectic Euler.
  const U = f.signal
  const V = f.signalVel
  const c2 = env.waveSpeed * env.waveSpeed
  const inv = 1 / (dx * dx)
  const gamma = env.waveDamping
  const kappa = env.waveStiffness
  const sponge = env.boundary === 'absorb' ? 3 : env.boundary === 'reflect' ? 0 : 0.8
  const blockSig = (a: number, b: number) => mask !== null && mask[a] !== mask[b] && hasFlag(w, mask[a] || mask[b], 2)
  for (let idx = 0; idx < c; idx++) {
    const i = idx % n
    const j = Math.floor(idx / n) % n
    const k = Math.floor(idx / nn)
    const u = U[idx]
    let lap = 0
    if (i > 0 && !blockSig(idx, idx - 1)) lap += U[idx - 1] - u
    if (i < n - 1 && !blockSig(idx, idx + 1)) lap += U[idx + 1] - u
    if (j > 0 && !blockSig(idx, idx - n)) lap += U[idx - n] - u
    if (j < n - 1 && !blockSig(idx, idx + n)) lap += U[idx + n] - u
    if (k > 0 && !blockSig(idx, idx - nn)) lap += U[idx - nn] - u
    if (k < n - 1 && !blockSig(idx, idx + nn)) lap += U[idx + nn] - u
    const edge = i === 0 || j === 0 || k === 0 || i === n - 1 || j === n - 1 || k === n - 1
    const damp = gamma + (edge ? sponge : 0)
    let vel = V[idx] + dt * (c2 * inv * lap - damp * V[idx] - kappa * u)
    if (vel > 40) vel = 40
    else if (vel < -40) vel = -40
    V[idx] = vel
  }
  for (let idx = 0; idx < c; idx++) {
    let u = U[idx] + dt * V[idx]
    if (u > 12) u = 12
    else if (u < -12) u = -12
    else if (!Number.isFinite(u)) u = 0
    U[idx] = u
  }
}

function hasFlag(w: WorldState, veilIndex1: number, flag: number): boolean {
  const v = w.veils[veilIndex1 - 1]
  return !!v && (v.mask & flag) !== 0
}

/** Vibration strength at p: how much the signal field is moving there. */
export function vibration(f: Field, p: Vec3): number {
  return Math.abs(sample(f.signal, f, p)) + 0.15 * Math.abs(sample(f.signalVel, f, p))
}
