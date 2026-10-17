import type { Vec3 } from './math'

/** A uniform grid of buckets for neighbour queries. Deterministic: insertion order is kept. */
export class SpatialHash<T extends { p: Vec3 }> {
  private cells = new Map<number, T[]>()
  constructor(private size: number) {}

  private key(ix: number, iy: number, iz: number): number {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512)
  }

  clear(): void {
    this.cells.clear()
  }

  insert(item: T): void {
    const s = this.size
    const k = this.key(Math.floor(item.p.x / s), Math.floor(item.p.y / s), Math.floor(item.p.z / s))
    let b = this.cells.get(k)
    if (!b) {
      b = []
      this.cells.set(k, b)
    }
    b.push(item)
  }

  build(items: T[]): this {
    this.clear()
    for (const it of items) this.insert(it)
    return this
  }

  /** Calls fn for every item within r of p (including the item at p itself, if any). */
  query(p: Vec3, r: number, fn: (item: T, d2: number) => void): void {
    const s = this.size
    const r2 = r * r
    const x0 = Math.floor((p.x - r) / s)
    const x1 = Math.floor((p.x + r) / s)
    const y0 = Math.floor((p.y - r) / s)
    const y1 = Math.floor((p.y + r) / s)
    const z0 = Math.floor((p.z - r) / s)
    const z1 = Math.floor((p.z + r) / s)
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const b = this.cells.get(this.key(ix, iy, iz))
          if (!b) continue
          for (const it of b) {
            const dx = it.p.x - p.x
            const dy = it.p.y - p.y
            const dz = it.p.z - p.z
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 <= r2) fn(it, d2)
          }
        }
  }
}
