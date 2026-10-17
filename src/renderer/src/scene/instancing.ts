import * as THREE from 'three'

export interface Instanced {
  mesh: THREE.InstancedMesh
  attrs: Record<string, THREE.InstancedBufferAttribute>
  max: number
}

/** An instanced mesh with extra per-instance attributes for shaders. */
export function makeInstanced(geometry: THREE.BufferGeometry, material: THREE.Material, max: number, attrs: Record<string, number>): Instanced {
  const g = geometry.clone()
  const out: Record<string, THREE.InstancedBufferAttribute> = {}
  for (const [name, size] of Object.entries(attrs)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size)
    a.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute(name, a)
    out[name] = a
  }
  const mesh = new THREE.InstancedMesh(g, material, max)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.count = 0
  mesh.frustumCulled = false
  return { mesh, attrs: out, max }
}

export function touch(inst: Instanced): void {
  inst.mesh.instanceMatrix.needsUpdate = true
  for (const a of Object.values(inst.attrs)) a.needsUpdate = true
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const tmpP = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const tmpD = new THREE.Vector3()

export function setTRS(inst: Instanced, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, q: THREE.Quaternion | null = null): void {
  tmpP.set(x, y, z)
  tmpS.set(sx, sy, sz)
  tmpM.compose(tmpP, q ?? tmpQ.identity(), tmpS)
  inst.mesh.setMatrixAt(i, tmpM)
}

/** A matrix placing a unit y-axis shape from a to b with thickness t. */
export function setSegment(inst: Instanced, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number): void {
  tmpD.set(bx - ax, by - ay, bz - az)
  const len = tmpD.length() || 1e-4
  tmpD.multiplyScalar(1 / len)
  tmpQ.setFromUnitVectors(UP, tmpD)
  tmpP.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
  tmpS.set(t, len, t)
  tmpM.compose(tmpP, tmpQ, tmpS)
  inst.mesh.setMatrixAt(i, tmpM)
}
