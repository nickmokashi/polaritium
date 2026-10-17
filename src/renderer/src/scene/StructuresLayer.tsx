import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { LIMITS } from '@core/sim/constants'
import { PULL_STRIDE, RING_STRIDE, VEIL_STRIDE } from '@core/sim/snapshot'
import { FOG, NOISE } from './glsl'
import { makeInstanced, setTRS, touch } from './instancing'
import { uniforms, useView, type ViewState } from './shared'

// Structures the simulation found: resonant rings (a halo whose brightness is the loop's
// coherence, turning when its rhythm winds), membranes (a translucent boundary that swells
// with the energy it holds), veils, pulls, and the bonds of colonies.

const RING_VERT = /* glsl */ `
attribute vec4 aR; // coherence, winding, energy, selected
varying vec4 vR; varying vec2 vUv; varying float vDist;
void main(){ vR = aR; vUv = uv; vec4 mv = viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.0); vDist=-mv.z; gl_Position = projectionMatrix*mv; }`
const RING_FRAG = /* glsl */ `
uniform float uTime; uniform float uSight;
${FOG}
varying vec4 vR; varying vec2 vUv; varying float vDist;
void main(){
  float coh = vR.x; float wind = vR.y;
  float around = vUv.x;
  float dash = wind != 0.0 ? 0.5 + 0.5*sin(6.2831*(around*6.0 - uTime*0.35*sign(wind))) : 1.0;
  float b = (0.08 + coh*0.32) * mix(0.55, 1.0, dash) * (1.0 + uSight*1.4) + vR.w*0.5;
  vec3 col = mix(vec3(0.7,0.72,0.8), vec3(0.95,0.95,1.0), coh) * b;
  gl_FragColor = vec4(applyFog(col, vDist*0.5), 1.0);
}`

const MEM_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aM; // energy, quickenings, seed, coherence
varying vec3 vN; varying vec3 vW; varying vec4 vM; varying float vDist;
${NOISE}
void main(){
  vM = aM;
  vec3 p = position * (1.0 + 0.04*snoise(position*2.0 + uTime*0.5 + aM.z) + 0.02*sin(uTime*2.0 + aM.z));
  vec4 wp = modelMatrix*instanceMatrix*vec4(p,1.0); vW = wp.xyz;
  vN = normalize(mat3(modelMatrix*instanceMatrix)*normal);
  vec4 mv = viewMatrix*wp; vDist=-mv.z; gl_Position = projectionMatrix*mv;
}`
const MEM_FRAG = /* glsl */ `
uniform float uTime;
${FOG}
varying vec3 vN; varying vec3 vW; varying vec4 vM; varying float vDist;
void main(){
  vec3 v = normalize(cameraPosition - vW);
  float ndv = abs(dot(normalize(vN), v));
  float rim = pow(1.0-ndv, 2.5);
  float e = clamp(vM.x/140.0, 0.0, 1.0);
  vec3 col = vec3(0.75,0.78,0.86)*rim*(0.35 + e) + vec3(0.6,0.55,0.95)*rim*e*0.25 + vec3(0.95)*pow(ndv,8.0)*e*0.15;
  gl_FragColor = vec4(applyFog(col, vDist*0.5), rim*0.85 + 0.04);
}`

const VEIL_FRAG = /* glsl */ `
uniform float uTime;
${NOISE}
varying vec3 vN; varying vec3 vW; varying vec4 vM; varying float vDist;
void main(){
  vec3 v = normalize(cameraPosition - vW);
  float ndv = abs(dot(normalize(vN), v));
  float rim = pow(1.0-ndv, 1.8);
  float shimmer = snoise(vW*0.35 + vec3(0.0, uTime*0.4, 0.0))*0.5+0.5;
  float fade = clamp(vM.x/90.0, 0.0, 1.0);
  vec3 col = vec3(0.55,0.57,0.65)*rim*(0.25 + 0.45*shimmer);
  gl_FragColor = vec4(col, (0.18 + rim*0.6)*fade);
}`

export function StructuresLayer() {
  const view = useView()
  const L = useMemo(() => {
    const torus = new THREE.TorusGeometry(1, 0.016, 6, 128)
    const ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime, uSight: uniforms.uSight, uFogColor: uniforms.uFogColor, uFogDensity: uniforms.uFogDensity } })
    const rings = makeInstanced(torus, ringMat, 60, { aR: 4 })
    rings.mesh.renderOrder = 6
    const sphere = new THREE.SphereGeometry(1, 40, 28)
    const memMat = new THREE.ShaderMaterial({ vertexShader: MEM_VERT, fragmentShader: MEM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: uniforms.uTime, uFogColor: uniforms.uFogColor, uFogDensity: uniforms.uFogDensity } })
    const mems = makeInstanced(sphere, memMat, 60, { aM: 4 })
    mems.mesh.renderOrder = 7
    const veilMat = new THREE.ShaderMaterial({ vertexShader: MEM_VERT, fragmentShader: VEIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: uniforms.uTime } })
    const veils = makeInstanced(sphere, veilMat, LIMITS.veils, { aM: 4 })
    veils.mesh.renderOrder = 8
    const pullMat = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime, uSight: uniforms.uSight, uFogColor: uniforms.uFogColor, uFogDensity: uniforms.uFogDensity } })
    const pulls = makeInstanced(new THREE.TorusGeometry(1, 0.02, 4, 64), pullMat, 8, { aR: 4 })
    const bondGeo = new THREE.BufferGeometry()
    bondGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LIMITS.organisms * 3 * 2 * 3), 3))
    const bonds = new THREE.LineSegments(bondGeo, new THREE.LineBasicMaterial({ color: 0x9aa0b0, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }))
    bonds.frustumCulled = false
    return { rings, mems, veils, pulls, bonds }
  }, [])

  useFrame(() => {
    const s = view.snap
    if (!s) return
    const q = new THREE.Quaternion()
    const z = new THREE.Vector3(0, 0, 1)
    const nrm = new THREE.Vector3()
    const nr = s.ringIds.length
    let mc = 0
    for (let i = 0; i < nr; i++) {
      const o = i * RING_STRIDE
      // centre from eased member positions so the halo sits on the moving loop
      let cx = 0
      let cy = 0
      let cz = 0
      let c = 0
      for (let k = s.ringOffsets[i]; k < s.ringOffsets[i + 1]; k++) {
        const ni = s.ringMembers[k]
        if (ni < 0) continue
        cx += view.nodePos[ni * 3]
        cy += view.nodePos[ni * 3 + 1]
        cz += view.nodePos[ni * 3 + 2]
        c++
      }
      if (c) {
        cx /= c
        cy /= c
        cz /= c
      } else {
        cx = s.rings[o]
        cy = s.rings[o + 1]
        cz = s.rings[o + 2]
      }
      nrm.set(s.rings[o + 3], s.rings[o + 4], s.rings[o + 5]).normalize()
      q.setFromUnitVectors(z, nrm)
      const r = s.rings[o + 6]
      setTRS(L.rings, i, cx, cy, cz, r, r, r, q)
      L.rings.attrs.aR.setXYZW(i, s.rings[o + 7], s.rings[o + 8], s.rings[o + 9], view.selected.has(s.ringIds[i]) ? 1 : 0)
      if (s.rings[o + 10] > 0) {
        const mr = Math.max(2.5, s.rings[o + 12])
        setTRS(L.mems, mc, cx, cy, cz, mr)
        L.mems.attrs.aM.setXYZW(mc, s.rings[o + 11], 0, s.ringIds[i] % 13, s.rings[o + 7])
        mc++
      }
    }
    L.rings.mesh.count = nr
    L.mems.mesh.count = mc
    touch(L.rings)
    touch(L.mems)
    const nv = s.veils.length / VEIL_STRIDE
    for (let i = 0; i < nv; i++) {
      const o = i * VEIL_STRIDE
      setTRS(L.veils, i, s.veils[o], s.veils[o + 1], s.veils[o + 2], s.veils[o + 3])
      L.veils.attrs.aM.setXYZW(i, s.veils[o + 4], 0, i, 0)
    }
    L.veils.mesh.count = nv
    touch(L.veils)
    const np = s.pulls.length / PULL_STRIDE
    const t = performance.now() * 0.001
    for (let i = 0; i < np; i++) {
      const o = i * PULL_STRIDE
      const k = 0.4 + 0.6 * ((t * (s.pulls[o + 4] > 0 ? -1 : 1) * 0.8) % 1 + 1) % 1
      setTRS(L.pulls, i, s.pulls[o], s.pulls[o + 1], s.pulls[o + 2], s.pulls[o + 3] * k)
      L.pulls.attrs.aR.setXYZW(i, 0.6, 0, 0, 0)
    }
    L.pulls.mesh.count = np
    touch(L.pulls)
    const pos = L.bonds.geometry.attributes.position as THREE.BufferAttribute
    const nb = s.bonds.length / 2
    let bc = 0
    for (let i = 0; i < nb; i++) {
      const a = s.bonds[i * 2]
      const b = s.bonds[i * 2 + 1]
      if (a < 0 || b < 0 || bc >= pos.count / 2) continue
      pos.setXYZ(bc * 2, view.orgPos[a * 3], view.orgPos[a * 3 + 1], view.orgPos[a * 3 + 2])
      pos.setXYZ(bc * 2 + 1, view.orgPos[b * 3], view.orgPos[b * 3 + 1], view.orgPos[b * 3 + 2])
      bc++
    }
    L.bonds.geometry.setDrawRange(0, bc * 2)
    pos.needsUpdate = true
  })

  return (
    <group>
      <primitive object={L.rings.mesh} />
      <primitive object={L.mems.mesh} />
      <primitive object={L.veils.mesh} />
      <primitive object={L.pulls.mesh} />
      <primitive object={L.bonds} />
    </group>
  )
}
