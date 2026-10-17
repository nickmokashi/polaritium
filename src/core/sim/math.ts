export interface Vec3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const vcopy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
export const vlen = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
export const vlen2 = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z
export const vdist = (a: Vec3, b: Vec3): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
export const vdist2 = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })

export function vnorm(a: Vec3, fallback: Vec3 = { x: 1, y: 0, z: 0 }): Vec3 {
  const l = vlen(a)
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : vcopy(fallback)
}

/** In-place add of s*b to a. */
export function vaddTo(a: Vec3, b: Vec3, s = 1): void {
  a.x += b.x * s
  a.y += b.y * s
  a.z += b.z * s
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const TAU = Math.PI * 2

/** Wraps an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  a = a % TAU
  if (a > Math.PI) a -= TAU
  else if (a <= -Math.PI) a += TAU
  return a
}

/** Wraps a phase to [0, 2pi). */
export function wrapPhase(a: number): number {
  a = a % TAU
  return a < 0 ? a + TAU : a
}

/** Replaces NaN or infinities with a safe value. The simulation never lets one through. */
export function finite(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback
}

/** Any vector perpendicular to n. */
export function perpendicular(n: Vec3): Vec3 {
  const up = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  return vnorm(vcross(n, up))
}

/** Exponential moving average factor for a time constant tau (seconds) at step dt. */
export const emaK = (dt: number, tau: number): number => 1 - Math.exp(-dt / Math.max(1e-6, tau))
