import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { SimEvent } from '@core/sim/types'
import { uniforms } from './shared'

// Bursts of light for things that happened in the simulation: a fracture's released energy,
// a collapse, a birth, a quickening, a pulse's expanding wavefront. Each burst is spawned by
// a real event and sized by the energy that event reported.

const MAX = 6000
const RINGS = 48

const P_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aVel; attribute vec4 aInfo; // birth, life, size, hue
varying float vA; varying float vHue;
void main(){
  float t = uTime - aInfo.x;
  float life = aInfo.y;
  float k = clamp(t/life, 0.0, 1.0);
  vec3 p = position + aVel * (1.0 - exp(-t*1.6)) / 1.6;
  vA = t < 0.0 || t > life ? 0.0 : (1.0 - k)*(1.0 - k);
  vHue = aInfo.w;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(aInfo.z * 60.0 / max(1.0, -mv.z), 0.0, 10.0) * (0.4 + 0.6*vA);
  gl_Position = projectionMatrix * mv;
}`
const P_FRAG = /* glsl */ `
varying float vA; varying float vHue;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; float d = dot(c,c); if (d > 1.0 || vA <= 0.0) discard;
  vec3 col = vHue < 0.5 ? vec3(1.0,0.97,0.92) : vHue < 1.5 ? vec3(1.0,0.75,0.45) : vHue < 2.5 ? vec3(0.7,0.62,1.0) : vec3(0.5,0.95,0.88);
  float a = vA*exp(-d*2.5);
  gl_FragColor = vec4(col*a*1.6, a);
}`

const R_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aRing; // birth, life, maxR, strength
varying float vA; varying vec2 vUv;
void main(){
  float t = uTime - aRing.x; float k = clamp(t/aRing.y, 0.0, 1.0);
  vA = (t < 0.0 || t > aRing.y) ? 0.0 : (1.0-k)*aRing.w;
  vUv = uv;
  float r = 0.5 + k*aRing.z;
  vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
  c.xy += position.xy * r;
  gl_Position = projectionMatrix * c;
}`
const R_FRAG = /* glsl */ `
varying float vA; varying vec2 vUv;
void main(){
  float d = length(vUv*2.0-1.0);
  float ring = smoothstep(0.85, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
  float a = ring*vA;
  gl_FragColor = vec4(vec3(0.8,0.84,0.95)*a, a);
}`

const queue: SimEvent[] = []
export function pushFx(events: SimEvent[]): void {
  for (const e of events) if (queue.length < 400) queue.push(e)
}

export function FxLayer() {
  const fx = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(MAX * 3)
    const vel = new Float32Array(MAX * 3)
    const info = new Float32Array(MAX * 4)
    for (let i = 0; i < MAX; i++) info[i * 4] = -999
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3))
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4))
    const m = new THREE.ShaderMaterial({ vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime } })
    const points = new THREE.Points(g, m)
    points.frustumCulled = false
    points.renderOrder = 11
    const rg = new THREE.PlaneGeometry(2, 2)
    const ra = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 4).fill(-999), 4)
    rg.setAttribute('aRing', ra)
    const rm = new THREE.ShaderMaterial({ vertexShader: R_VERT, fragmentShader: R_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime } })
    const rings = new THREE.InstancedMesh(rg, rm, RINGS)
    rings.frustumCulled = false
    rings.renderOrder = 12
    return { g, pos, vel, info, points, rings, ra, cursor: 0, rc: 0 }
  }, [])

  useFrame(() => {
    if (!queue.length) return
    const now = uniforms.uTime.value
    const P = fx.g.attributes.position as THREE.BufferAttribute
    const V = fx.g.attributes.aVel as THREE.BufferAttribute
    const I = fx.g.attributes.aInfo as THREE.BufferAttribute
    let s = (now * 1000) | 0
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    const burst = (e: SimEvent, n: number, speed: number, size: number, hue: number, life = 1.4) => {
      for (let k = 0; k < n; k++) {
        const i = fx.cursor
        fx.cursor = (fx.cursor + 1) % MAX
        let x = 0
        let y = 0
        let z = 0
        do {
          x = rnd() * 2 - 1
          y = rnd() * 2 - 1
          z = rnd() * 2 - 1
        } while (x * x + y * y + z * z > 1)
        const sp = speed * (0.4 + rnd())
        P.setXYZ(i, e.x, e.y, e.z)
        V.setXYZ(i, x * sp, y * sp, z * sp)
        I.setXYZW(i, now, life * (0.6 + rnd() * 0.6), size * (0.6 + rnd() * 0.8), hue)
      }
    }
    const ring = (e: SimEvent, r: number, life: number, strength: number) => {
      const i = fx.rc
      fx.rc = (fx.rc + 1) % RINGS
      fx.rings.setMatrixAt(i, new THREE.Matrix4().makeTranslation(e.x, e.y, e.z))
      fx.ra.setXYZW(i, now, life, r, strength)
    }
    for (const e of queue.splice(0, queue.length)) {
      const v = Math.max(0, e.value ?? 0)
      switch (e.type) {
        case 'fracture':
        case 'cut':
          burst(e, 40 + Math.min(120, v * 6), 6, 1.2, 1)
          ring(e, 6, 0.6, 0.6)
          break
        case 'collapse':
          burst(e, 220, 10, 1.6, 2, 2.2)
          ring(e, 26, 1.6, 1)
          break
        case 'shatter':
          burst(e, 160, 12, 1.5, 0, 1.8)
          ring(e, 16, 1, 0.8)
          break
        case 'birth':
          burst(e, 90, 3, 1.3, 0, 2.2)
          ring(e, 8, 1.4, 0.8)
          break
        case 'quickening':
          burst(e, 120, 2.5, 1.2, 3, 2.6)
          ring(e, 10, 2, 0.9)
          break
        case 'membrane':
        case 'ringFormed':
          ring(e, 12, 2.2, 0.6)
          break
        case 'pulse':
          ring(e, 6 + v * 3, 1.4, 0.9)
          burst(e, 20 + v * 4, 4 + v, 1, 0, 0.9)
          break
        case 'quake':
          ring(e, 60, 2.4, 0.7)
          break
        case 'crystalBreak':
          burst(e, 30, 4, 1, 3, 1.2)
          break
        case 'division':
          burst(e, 18, 1.5, 0.8, 0, 0.9)
          break
        case 'death':
          burst(e, 14, 1, 0.8, 2, 1.6)
          break
        case 'transform':
          burst(e, 80, 4, 1.2, 2, 1.8)
          ring(e, 10, 1.4, 0.8)
          break
        case 'fuse':
          burst(e, 70, 5, 1.2, 0, 1.4)
          ring(e, 8, 1, 0.8)
          break
        case 'regrowth':
          burst(e, 25, 1.5, 0.9, 3, 1.6)
          break
        case 'finding':
          ring(e, 18, 2.6, 0.7)
          break
      }
    }
    P.needsUpdate = true
    V.needsUpdate = true
    I.needsUpdate = true
    fx.rings.instanceMatrix.needsUpdate = true
    fx.ra.needsUpdate = true
  })

  return (
    <group>
      <primitive object={fx.points} />
      <primitive object={fx.rings} />
    </group>
  )
}
