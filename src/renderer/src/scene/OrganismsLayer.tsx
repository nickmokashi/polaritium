import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { LIMITS } from '@core/sim/constants'
import { ORG_STRIDE } from '@core/sim/snapshot'
import { FOG, LIGHTS, NOISE } from './glsl'
import { makeInstanced, setTRS, touch } from './instancing'
import { uniforms, useView, type ViewState } from './shared'

// Procedural bodies. One base sphere is reshaped per organism by its genome: lobes from its
// symmetry gene, spikes and shell from its shell gene, an elongated swimming body for motile
// forms with a tail that ripples at its speed, a ringed form for oscillators.

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aO1; // energy, lobes, shell, phase
attribute vec4 aO2; // flash, state, hue, speed
attribute vec4 aO3; // siphon, sens, diet, family
varying vec3 vNormal; varying vec3 vWorld; varying vec4 vO1; varying vec4 vO2; varying vec4 vO3; varying float vDist; varying vec3 vObj;
${NOISE}
void main(){
  vO1=aO1; vO2=aO2; vO3=aO3;
  vec3 p = position; vec3 nrm = normal;
  float fam = aO3.w; float lobes = aO1.y; float shell = aO1.z; float speed = aO2.w;
  float th = atan(p.y, p.x); float ph = acos(clamp(p.z, -1.0, 1.0));
  float r = 1.0;
  if (fam < 0.5) { // membrane: soft lobed bubble that breathes
    r += 0.07*sin(lobes*th + uTime*1.4)*sin(ph) + 0.05*sin(uTime*1.1 + aO1.w);
  } else if (fam < 1.5) { // motile: a streamlined body, tail rippling with speed
    p.z *= 1.75; p.xy *= 0.72;
    float tail = smoothstep(0.2, -1.6, p.z);
    p.x += sin(p.z*3.2 - uTime*(2.0 + speed*2.5))*0.22*tail;
    r += 0.05*sin(lobes*th)*sin(ph);
  } else if (fam < 2.5) { // oscillating: a flattened ring-like body with radial lobes
    p.z *= 0.45;
    r += 0.18*pow(abs(sin(lobes*th*0.5)), 3.0);
  } else { // adaptive: spiked, sharper with a thicker shell
    float sp = pow(max(0.0, sin(lobes*th)*sin(lobes*ph)), 6.0 - shell*3.0);
    r += sp*(0.35 + shell*0.4) + 0.04*snoise(p*3.0 + uTime*0.4);
  }
  p *= r;
  vObj = p;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p,1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix*instanceMatrix) * nrm);
  vec4 mv = viewMatrix * wp; vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
uniform float uTime; uniform float uSight; uniform float uFlashLimit;
${LIGHTS}
${FOG}
varying vec3 vNormal; varying vec3 vWorld; varying vec4 vO1; varying vec4 vO2; varying vec4 vO3; varying float vDist; varying vec3 vObj;
vec3 hsv(float h, float s, float v){ vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0); vec3 p = abs(fract(vec3(h)+k)*6.0-3.0); return v*mix(vec3(1.0), clamp(p-1.0,0.0,1.0), s); }
void main(){
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n,v),0.0);
  float energy = vO1.x; float flash = vO2.x * uFlashLimit; float state = vO2.y; float fam = vO3.w;
  vec3 tint = hsv(vO2.z, 0.16, 1.0);
  vec3 lit = litBy(vWorld, n, v, 40.0, 0.8);
  float dormant = abs(state - 4.0) < 0.5 ? 1.0 : 0.0;
  vec3 body = vec3(0.55,0.57,0.62)*tint*(0.25 + lit*0.9);
  float rim = pow(1.0-ndv, 2.2);
  float inner = smoothstep(0.35, 1.0, ndv);
  vec3 col = body + tint*rim*(0.35 + energy*0.8);
  if (fam < 0.5) col = tint*rim*(0.5+energy) + vec3(0.9,0.92,1.0)*inner*inner*(0.15 + energy*0.6);
  col += vec3(1.0,0.98,0.94)*flash*1.8 + vec3(0.6,0.95,0.9)*vO3.x*0.6;
  col *= mix(1.0, 0.3, dormant);
  col *= mix(1.0, 0.6, uSight);
  float alpha = fam < 0.5 ? clamp(0.35 + rim*0.7 + inner*0.3, 0.0, 1.0) : 1.0;
  gl_FragColor = vec4(applyFog(col, vDist*0.6), alpha);
}`

export function OrganismsLayer() {
  const view = useView()
  const inst = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 28, 20)
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      uniforms: {
        uTime: uniforms.uTime,
        uSight: uniforms.uSight,
        uFlashLimit: uniforms.uFlashLimit,
        uLights: view.u.uLights,
        uLightCount: view.u.uLightCount,
        uFogColor: uniforms.uFogColor,
        uFogDensity: uniforms.uFogDensity
      }
    })
    const i = makeInstanced(geo, mat, LIMITS.organisms, { aO1: 4, aO2: 4, aO3: 4 })
    i.mesh.renderOrder = 4
    return i
  }, [])

  useFrame(() => {
    const s = view.snap
    if (!s) return
    const q = new THREE.Quaternion()
    const fwd = new THREE.Vector3(0, 0, 1)
    const h = new THREE.Vector3()
    const n = s.organismIds.length
    for (let i = 0; i < n; i++) {
      const o = i * ORG_STRIDE
      h.set(s.organisms[o + 3], s.organisms[o + 4], s.organisms[o + 5])
      if (h.lengthSq() < 1e-6) h.set(0, 0, 1)
      q.setFromUnitVectors(fwd, h.normalize())
      const r = s.organisms[o + 6] * (view.selected.has(s.organismIds[i]) ? 1.12 : 1)
      setTRS(inst, i, view.orgPos[i * 3], view.orgPos[i * 3 + 1], view.orgPos[i * 3 + 2], r, r, r, q)
      inst.attrs.aO1.setXYZW(i, s.organisms[o + 7], s.organisms[o + 9], s.organisms[o + 10], s.organisms[o + 11])
      inst.attrs.aO2.setXYZW(i, s.organisms[o + 12], s.organisms[o + 13], s.organisms[o + 14], s.organisms[o + 15])
      inst.attrs.aO3.setXYZW(i, s.organisms[o + 16], s.organisms[o + 18], s.organisms[o + 19], s.organisms[o + 8])
    }
    inst.mesh.count = n
    touch(inst)
  })

  return <primitive object={inst.mesh} />
}
