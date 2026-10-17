import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { LIMITS } from '@core/sim/constants'
import { NODE_STRIDE } from '@core/sim/snapshot'
import { FOG, LIGHTS, NOISE } from './glsl'
import { makeInstanced, setTRS, touch } from './instancing'
import { uniforms, useView, type ViewState } from './shared'

// Light, dark and grey. Brightness, size, pulse, flicker and rim all come from the node's
// fill, phase, glow and saturation as the simulation reports them.

const VERT = /* glsl */ `
attribute vec4 aData;   // fill, phase, glow, sat
attribute vec4 aData2;  // freq, flags, seed, selected
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vObj;
varying vec4 vData;
varying vec4 vData2;
varying float vDist;
void main(){
  vData = aData; vData2 = aData2;
  vObj = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FRAG_WHITE = /* glsl */ `
uniform float uTime; uniform float uSight; uniform float uFlashLimit;
${NOISE}
${FOG}
varying vec3 vNormal; varying vec3 vWorld; varying vec3 vObj; varying vec4 vData; varying vec4 vData2; varying float vDist;
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n,v),0.0);
  float fill = vData.x; float phase = vData.y; float glow = vData.z; float sat = vData.w;
  float pulse = 0.88 + 0.12*sin(phase);
  float plasma = snoise(vObj*2.6 + vec3(0.0, uTime*0.35, vData2.z*10.0))*0.5+0.5;
  float churn = snoise(vObj*7.0 - uTime*0.9)*0.5+0.5;
  vec3 core = mix(vec3(0.82,0.83,0.86), vec3(1.0,0.99,0.97), plasma*0.7+churn*0.3);
  float flick = sat > 0.3 ? mix(1.0, 0.55 + 0.45*step(0.5, hash11(floor(uTime*22.0)+vData2.z*91.0)), sat*uFlashLimit) : 1.0;
  float intensity = (0.55 + 2.1*fill) * pulse * flick + glow*1.6;
  vec3 col = core * intensity * (0.75 + 0.25*ndv) + vec3(0.9,0.92,1.0)*pow(1.0-ndv,2.0)*0.6;
  col += vData2.w * vec3(0.25,0.25,0.3)*pow(1.0-ndv,1.5);
  col *= mix(1.0, 0.45, uSight);
  gl_FragColor = vec4(applyFog(col, vDist*0.6), 1.0);
}`

const FRAG_BLACK = /* glsl */ `
uniform float uTime; uniform float uSight;
${NOISE}
${LIGHTS}
${FOG}
varying vec3 vNormal; varying vec3 vWorld; varying vec3 vObj; varying vec4 vData; varying vec4 vData2; varying float vDist;
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n,v),0.0);
  float fill = vData.x; float sat = vData.w; float well = mod(vData2.y, 2.0);
  // an inward swirl: energy being drawn in
  float r = 1.0 - ndv;
  float ang = atan(vObj.y, vObj.x);
  float swirl = snoise(vec3(ang*1.5 + r*3.0 - uTime*0.25, r*6.0 + uTime*0.6, vData2.z*7.0))*0.5+0.5;
  vec3 base = vec3(0.006,0.006,0.008) + vec3(0.02,0.02,0.028)*swirl*(0.3+fill);
  vec3 lit = litBy(vWorld, n, v, 90.0, 1.4);
  base += lit * vec3(0.06);
  float spec = 0.0;
  float rimP = pow(1.0-ndv, 3.2);
  vec3 rimCol = mix(vec3(0.62,0.64,0.72), vec3(0.62,0.52,0.98), sat*0.8);
  vec3 col = base + rimCol * rimP * (0.8 + 1.4*fill + 0.8*well) + lit*0.35*pow(max(dot(reflect(-v,n), vec3(0.0,1.0,0.0)),0.0),12.0);
  col += vec3(0.85,0.8,1.0) * vData.z * rimP * 1.5;
  col += vData2.w * vec3(0.3)*rimP;
  col *= mix(1.0, 0.5, uSight);
  gl_FragColor = vec4(applyFog(col, vDist*0.6), 1.0);
}`

const FRAG_GREY = /* glsl */ `
uniform float uTime; uniform float uSight;
${LIGHTS}
${FOG}
varying vec3 vNormal; varying vec3 vWorld; varying vec3 vObj; varying vec4 vData; varying vec4 vData2; varying float vDist;
void main(){
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(cameraPosition - vWorld);
  if(dot(n,v) < 0.0) n = -n;
  float ndv = max(dot(n,v),0.0);
  vec3 r = reflect(-v, n);
  float env = smoothstep(-0.3, 0.9, r.y)*0.55 + 0.06 + 0.25*smoothstep(0.6,1.0,abs(r.x));
  vec3 lit = litBy(vWorld, n, v, 60.0, 2.2);
  float fill = vData.x; float glow = vData.z;
  vec3 col = vec3(0.6,0.62,0.66)*env + lit*vec3(0.55,0.56,0.6) + vec3(0.7,0.72,0.78)*pow(1.0-ndv,2.5)*0.35;
  col += vec3(1.0,0.98,0.95) * glow * 2.4 + vec3(0.25,0.26,0.3)*fill*0.6;
  col += vData2.w * vec3(0.3)*pow(1.0-ndv,1.5);
  col *= mix(1.0, 0.55, uSight);
  gl_FragColor = vec4(applyFog(col, vDist*0.6), 1.0);
}`

// A soft dark disc behind every dark node: it absorbs the glow of the space behind it.
const HALO_VERT = /* glsl */ `
attribute vec4 aData;
varying vec2 vUv; varying float vFill;
void main(){
  vUv = uv*2.0-1.0; vFill = aData.x;
  vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
  float s = length(instanceMatrix[0].xyz);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}`
const HALO_FRAG = /* glsl */ `
varying vec2 vUv; varying float vFill;
void main(){
  float d = length(vUv);
  float a = smoothstep(1.0, 0.25, d) * (0.55 + 0.4*vFill);
  gl_FragColor = vec4(0.0,0.0,0.0,a);
}`

// A soft corona around every light, brighter the fuller it is, so light reads as light even
// without the glow effect switched on.
const CORONA_FRAG = /* glsl */ `
uniform float uFlashLimit;
varying vec2 vUv; varying float vFill; varying float vGlow;
void main(){
  float d = length(vUv);
  float core = exp(-d*d*9.0);
  float wide = exp(-d*3.2)*0.35;
  float a = (core + wide) * (0.22 + 0.7*vFill + vGlow*0.6*uFlashLimit) * smoothstep(1.0, 0.7, d);
  gl_FragColor = vec4(vec3(1.0,0.975,0.94)*a, a);
}`
const CORONA_VERT = /* glsl */ `
attribute vec4 aData;
varying vec2 vUv; varying float vFill; varying float vGlow;
void main(){
  vUv = uv*2.0-1.0; vFill = aData.x; vGlow = aData.z;
  vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
  float s = length(instanceMatrix[0].xyz);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}`

function material(frag: string, view: ViewState): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: frag,
    uniforms: {
      uTime: uniforms.uTime,
      uLights: view.u.uLights,
      uLightCount: view.u.uLightCount,
      uFogColor: uniforms.uFogColor,
      uFogDensity: uniforms.uFogDensity,
      uSight: uniforms.uSight,
      uFlashLimit: uniforms.uFlashLimit
    }
  })
}

export function NodesLayer() {
  const view = useView()
  const layers = useMemo(() => {
    const sphere = new THREE.IcosahedronGeometry(1, 5)
    const facet = new THREE.IcosahedronGeometry(1, 0)
    const attrs = { aData: 4, aData2: 4 }
    const white = makeInstanced(sphere, material(FRAG_WHITE, view), LIMITS.nodes, attrs)
    const black = makeInstanced(sphere, material(FRAG_BLACK, view), LIMITS.nodes, attrs)
    const grey = makeInstanced(facet, material(FRAG_GREY, view), LIMITS.nodes, attrs)
    const halo = makeInstanced(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false }),
      LIMITS.nodes,
      { aData: 4 }
    )
    halo.mesh.renderOrder = 2
    const corona = makeInstanced(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uFlashLimit: uniforms.uFlashLimit } }),
      LIMITS.nodes,
      { aData: 4 }
    )
    corona.mesh.renderOrder = 9
    return { white, black, grey, halo, corona }
  }, [])

  useFrame(() => {
    const s = view.snap
    if (!s) return
    const counts = [0, 0, 0]
    let hc = 0
    let cc = 0
    const sets = [layers.black, layers.white, layers.grey]
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (let i = 0; i < s.nodeIds.length; i++) {
      const o = i * NODE_STRIDE
      const kind = s.nodes[o + 6]
      const set = sets[kind]
      const k = counts[kind]++
      const x = view.nodePos[i * 3]
      const y = view.nodePos[i * 3 + 1]
      const z = view.nodePos[i * 3 + 2]
      const r = s.nodes[o + 3]
      if (kind === 2) {
        e.set(s.nodes[o + 5] * 0.5, s.nodes[o + 5], 0)
        q.setFromEuler(e)
        setTRS(set, k, x, y, z, r * 1.15, r * 1.15, r * 1.15, q)
      } else setTRS(set, k, x, y, z, r)
      const sel = view.selected.has(s.nodeIds[i]) ? 1 : view.hover === s.nodeIds[i] ? 0.5 : 0
      set.attrs.aData.setXYZW(k, s.nodes[o + 4], s.nodes[o + 5], s.nodes[o + 8], s.nodes[o + 7])
      set.attrs.aData2.setXYZW(k, s.nodes[o + 9], s.nodes[o + 10], (s.nodeIds[i] % 97) / 97, sel)
      if (kind === 1) {
        setTRS(layers.corona, cc, x, y, z, r * (5 + 4 * s.nodes[o + 4]))
        layers.corona.attrs.aData.setXYZW(cc, s.nodes[o + 4], 0, s.nodes[o + 8], 0)
        cc++
      }
      if (kind === 0) {
        setTRS(layers.halo, hc, x, y, z, r * 3.2)
        layers.halo.attrs.aData.setXYZW(hc, s.nodes[o + 4], 0, 0, 0)
        hc++
      }
    }
    sets.forEach((set, kind) => {
      set.mesh.count = counts[kind]
      touch(set)
    })
    layers.halo.mesh.count = view.sight ? 0 : hc
    touch(layers.halo)
    layers.corona.mesh.count = view.sight ? 0 : cc
    touch(layers.corona)
  })

  return (
    <group>
      <primitive object={layers.halo.mesh} />
      <primitive object={layers.black.mesh} />
      <primitive object={layers.white.mesh} />
      <primitive object={layers.grey.mesh} />
      <primitive object={layers.corona.mesh} />
    </group>
  )
}
