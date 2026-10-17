import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { NODE_STRIDE } from '@core/sim/snapshot'
import { uniforms, useView, type ViewState } from './shared'

// The medium made visible. Motes of dust fill the chamber; each one samples the simulation's
// radiance and signal fields at its position, so they brighten where light pools and ripple
// as vibration passes through. Under the Lens, the fields themselves show, and every node
// shows the force it feels.

const DUST_VERT = /* glsl */ `
uniform float uTime; uniform float uHalf; uniform float uLens; uniform float uRadius;
uniform sampler3D uRad; uniform sampler3D uSig;
attribute vec3 aSeed; attribute float aRand;
varying float vB; varying float vS; varying float vRand;
void main(){
  vec3 p = aSeed * uRadius;
  p += vec3(sin(uTime*0.05 + aRand*40.0), cos(uTime*0.04 + aRand*21.0), sin(uTime*0.045 + aRand*13.0)) * 1.4;
  vec3 uvw = clamp((p + uHalf) / (2.0*uHalf), 0.0, 1.0);
  float rad = texture(uRad, uvw).r;
  float sig = texture(uSig, uvw).r*2.0 - 1.0;
  vec3 dir = normalize(vec3(aRand-0.5, fract(aRand*7.3)-0.5, fract(aRand*13.1)-0.5));
  p += dir * sig * 2.2;
  vB = rad; vS = sig; vRand = aRand;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float size = (1.3 + rad*3.2 + abs(sig)*2.4 + uLens*1.5) * (0.6 + fract(aRand*91.0));
  gl_PointSize = clamp(size * 110.0 / max(1.0, -mv.z), 1.0, 8.0);
  gl_Position = projectionMatrix * mv;
}`

const DUST_FRAG = /* glsl */ `
uniform float uLens; uniform float uSight;
varying float vB; varying float vS; varying float vRand;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0;
  float d = dot(c,c);
  if (d > 1.0) discard;
  float soft = exp(-d*3.0);
  vec3 base = vec3(0.55,0.57,0.63);
  vec3 warm = vec3(1.0,0.96,0.88);
  vec3 col = mix(base, warm, clamp(vB*1.5, 0.0, 1.0));
  float a = (0.13 + vB*0.6 + abs(vS)*0.6) * soft * (0.75 + 0.25*sin(vRand*80.0 + vB*3.0));
  if (uLens > 0.5) {
    col = mix(col, vS > 0.0 ? vec3(0.45,0.92,0.85) : vec3(0.7,0.6,1.0), clamp(abs(vS)*2.5, 0.0, 1.0));
    a = (0.12 + vB*0.8 + abs(vS)*1.2) * soft;
  }
  a *= (1.0 - uSight*0.8);
  gl_FragColor = vec4(col*a, a);
}`

function makeTex(n: number): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array(n * n * n), n, n, n)
  t.format = THREE.RedFormat
  t.type = THREE.UnsignedByteType
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping
  t.unpackAlignment = 1
  t.needsUpdate = true
  return t
}

export function FieldLayer() {
  const view = useView()
  const dust = useMemo(() => {
    const max = 30000
    const g = new THREE.BufferGeometry()
    const seed = new Float32Array(max * 3)
    const rand = new Float32Array(max)
    let s = 1234567
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < max; i++) {
      let x = 0
      let y = 0
      let z = 0
      do {
        x = rnd() * 2 - 1
        y = rnd() * 2 - 1
        z = rnd() * 2 - 1
      } while (x * x + y * y + z * z > 1)
      seed[i * 3] = x
      seed[i * 3 + 1] = y
      seed[i * 3 + 2] = z
      rand[i] = rnd()
    }
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3))
    g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1))
    const rad = makeTex(24)
    const sig = makeTex(24)
    view.u.uRadiance.value = rad
    view.u.uSignal.value = sig
    const m = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: uniforms.uTime, uHalf: view.u.uFieldHalf, uLens: uniforms.uLens, uSight: uniforms.uSight, uRadius: view.u.uRadius, uRad: { value: rad }, uSig: { value: sig } }
    })
    const points = new THREE.Points(g, m)
    points.frustumCulled = false
    points.renderOrder = 1
    return { points, g, rad, sig }
  }, [])

  const arrows = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(260 * 2 * 3), 3))
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8fe6da, transparent: true, opacity: 0.8 }))
    l.frustumCulled = false
    l.renderOrder = 9
    return l
  }, [])

  useEffect(() => () => {
    dust.g.dispose()
    dust.rad.dispose()
    dust.sig.dispose()
  }, [dust])

  useFrame(() => {
    const s = view.snap
    dust.g.setDrawRange(0, view.dustCount + (view.lens ? 6000 : 0))
    if (!s) return
    if (s.radiance && s.signal && s.fieldN === 24) {
      const R = dust.rad.image.data as Uint8Array
      const S = dust.sig.image.data as Uint8Array
      for (let i = 0; i < R.length; i++) {
        R[i] = Math.min(255, Math.sqrt(Math.max(0, s.radiance[i]) / 6) * 255)
        S[i] = Math.max(0, Math.min(255, (s.signal[i] / 3) * 127 + 128))
      }
      dust.rad.needsUpdate = true
      dust.sig.needsUpdate = true
      view.u.uFieldHalf.value = s.fieldHalf
    }
    arrows.visible = view.lens
    if (view.lens) {
      const pos = arrows.geometry.attributes.position as THREE.BufferAttribute
      const n = Math.min(260, s.nodeIds.length)
      for (let i = 0; i < n; i++) {
        const o = i * NODE_STRIDE
        const x = view.nodePos[i * 3]
        const y = view.nodePos[i * 3 + 1]
        const z = view.nodePos[i * 3 + 2]
        const fx = s.nodes[o + 13]
        const fy = s.nodes[o + 14]
        const fz = s.nodes[o + 15]
        const f = Math.hypot(fx, fy, fz)
        const k = f > 1e-4 ? Math.min(8, 2 + Math.log1p(f) * 3) / f : 0
        pos.setXYZ(i * 2, x, y, z)
        pos.setXYZ(i * 2 + 1, x + fx * k, y + fy * k, z + fz * k)
      }
      arrows.geometry.setDrawRange(0, n * 2)
      pos.needsUpdate = true
    }
  })

  return (
    <group>
      <primitive object={dust.points} />
      <primitive object={arrows} />
    </group>
  )
}
