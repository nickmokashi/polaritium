// Seeded randomness. The world carries its generator state, so a saved world resumes
// exactly where it left off, and the same seed plus the same actions gives the same universe.

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randRange(state: { rng: number }, lo: number, hi: number): number {
  return lo + (hi - lo) * nextRandom(state)
}

export function randInt(state: { rng: number }, lo: number, hiInclusive: number): number {
  return lo + Math.floor(nextRandom(state) * (hiInclusive - lo + 1))
}

/** Standard normal sample (Box-Muller, always two draws so the stream stays aligned). */
export function randNormal(state: { rng: number }): number {
  const u = Math.max(1e-12, nextRandom(state))
  const v = nextRandom(state)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** A point uniformly inside a sphere. */
export function randInSphere(state: { rng: number }, r: number): { x: number; y: number; z: number } {
  for (let i = 0; i < 16; i++) {
    const x = randRange(state, -1, 1)
    const y = randRange(state, -1, 1)
    const z = randRange(state, -1, 1)
    if (x * x + y * y + z * z <= 1) return { x: x * r, y: y * r, z: z * r }
  }
  return { x: 0, y: 0, z: 0 }
}

export function randUnit(state: { rng: number }): { x: number; y: number; z: number } {
  const z = randRange(state, -1, 1)
  const a = randRange(state, 0, Math.PI * 2)
  const s = Math.sqrt(1 - z * z)
  return { x: s * Math.cos(a), y: s * Math.sin(a), z }
}

/** Turns any string seed into a 32-bit state. */
export function seedFrom(text: string | number): number {
  const s = String(text)
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h || 0x9e3779b9
}
