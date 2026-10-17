import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { LIMITS } from '@core/sim/constants'
import { NODE_STRIDE, STRAND_STRIDE } from '@core/sim/snapshot'
import { envOf } from '@core/sim/environments'
import { FOG } from './glsl'
import { uniforms, useView, type ViewState } from './shared'

// The Grey Strand, drawn. Each filament is a camera-facing ribbon bent in the vertex shader:
// slack strands sag, tense ones run straight, swinging flow becomes a travelling wave, twist
// becomes a helix, strain becomes vibration and flicker, and energy runs along it as pulses
// moving in the direction and at the speed of the measured flow.

const SEGS = 64

const VERT = /* glsl */ `
uniform float uTime; uniform float uSight;
attribute vec3 aA; attribute vec3 aB;
attribute vec4 aP1; // current, tension, stress, amp
attribute vec4 aP2; // twist, lock, coupling, oscFreq
attribute vec4 aP3; // carried, origin, birth, highlight
varying float vT; varying float vSide; varying float vLen;
varying vec4 vP1; varying vec4 vP2; varying vec4 vP3; varying float vDist;
float h1(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}
void main(){
  vP1=aP1; vP2=aP2; vP3=aP3;
  vec3 d = aB - aA; float len = max(length(d), 1e-3); vec3 dir = d/len;
  vec3 up = abs(dir.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 n1 = normalize(cross(dir, up)); vec3 n2 = cross(dir, n1);
  float t = position.x; vT = t; vSide = position.y; vLen = len;
  vec3 p = aA + d*t;
  float env = sin(3.14159265*t);
  float tension = aP1.y; float stress = aP1.z; float amp = aP1.w;
  // slack hangs, tension straightens
  float slack = clamp(-tension, 0.0, 3.0);
  p += vec3(0.0,-1.0,0.0) * slack * len * 0.035 * env;
  // swinging flow travels as a wave
  float waveA = min(clamp(amp, 0.0, 1.2)*0.32 + stress*0.12, len*0.035);
  float ph = 6.2831853*(t*max(1.0, len/16.0) - uTime*max(aP2.w, 0.35));
  p += n1 * sin(ph) * waveA * env;
  // twist winds the filament into a helix
  float tw = aP2.x;
  float ang = tw*t*2.0 + uTime*0.9*sign(tw);
  p += (n1*cos(ang) + n2*sin(ang)) * min(abs(tw), 3.14)*0.16*env;
  // strain shakes it
  p += n2 * (h1(t*53.0 + floor(uTime*40.0)) - 0.5) * stress*stress*min(0.45, len*0.02) * env;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  vec3 tv = normalize((viewMatrix * vec4(dir, 0.0)).xyz);
  vec3 side = normalize(cross(tv, normalize(-mv.xyz)));
  float width = 0.045 + aP2.z*0.05 + min(abs(aP1.x), 8.0)*0.012 + aP3.w*0.06 + uSight*0.05;
  width *= max(1.0, vDist*0.012);
  mv.xyz += side * position.y * width;
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
uniform float uTime; uniform float uSight; uniform float uFlashLimit;
${FOG}
varying float vT; varying float vSide; varying float vLen;
varying vec4 vP1; varying vec4 vP2; varying vec4 vP3; varying float vDist;
float h1(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}
void main(){
  float current = vP1.x; float stress = vP1.z; float lock = vP2.y; float origin = vP3.y; float birth = vP3.z;
  float core = exp(-vSide*vSide*5.0);
  float flow = abs(current);
  float dash = smoothstep(0.72, 1.0, fract(vT*vLen*0.16 - uTime*current*0.32)) * min(1.0, flow*0.45);
  float breathe = lock*(0.55 + 0.45*sin(uTime*3.1));
  float bright = 0.2 + min(flow, 6.0)*0.09 + dash*1.1 + breathe*0.25;
  if (origin > 0.5 && origin < 1.5) bright *= 0.5;
  if (origin > 6.5) bright = vP3.x * (0.5 + 0.5*h1(floor(uTime*7.0) + floor(vT*9.0)));
  float flick = mix(1.0, 0.25 + 0.75*step(0.4, h1(floor(uTime*16.0) + vT*7.0)), smoothstep(0.45, 1.0, stress)*uFlashLimit);
  bright *= flick;
  float bead = birth > 0.0 ? exp(-pow((vT-0.5)*vLen*0.55, 2.0))*birth*birth*1.8 : 0.0;
  vec3 col = mix(vec3(0.66,0.69,0.76), vec3(1.0,1.0,0.98), clamp(flow*0.14 + lock*0.35, 0.0, 1.0));
  // strain warms toward amber; in Strand Sight, resonance shows in teal
  col = mix(col, vec3(1.0,0.74,0.42), smoothstep(0.35, 1.0, stress));
  col = mix(col, vec3(0.5,0.95,0.88), uSight*lock*0.6);
  col *= bright*(1.0 + uSight*0.8);
  col += vec3(0.95,0.95,1.0)*bead;
  col += vec3(0.7)*vP3.w*0.6;
  float a = core;
  gl_FragColor = vec4(applyFog(col, vDist*0.5)*a, a);
}`

export function StrandsLayer() {
  const view = useView()
  const mesh = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 2, SEGS, 1)
    const pos = base.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + 0.5)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', pos)
    const max = LIMITS.strands
    const add = (name: string, size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size)
      a.setUsage(THREE.DynamicDrawUsage)
      g.setAttribute(name, a)
      return a
    }
    const attrs = { aA: add('aA', 3), aB: add('aB', 3), aP1: add('aP1', 4), aP2: add('aP2', 4), aP3: add('aP3', 4) }
    g.instanceCount = 0
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: uniforms.uTime, uSight: uniforms.uSight, uFlashLimit: uniforms.uFlashLimit, uFogColor: uniforms.uFogColor, uFogDensity: uniforms.uFogDensity }
    })
    const mesh = new THREE.Mesh(g, m)
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    return { mesh, g, attrs }
  }, [])

  useFrame(() => {
    const s = view.snap
    if (!s) return
    const { attrs, g } = mesh
    let k = 0
    for (let i = 0; i < s.strandIds.length; i++) {
      const o = i * STRAND_STRIDE
      const a = s.strands[o]
      const b = s.strands[o + 1]
      if (a < 0 || b < 0) continue
      attrs.aA.setXYZ(k, view.nodePos[a * 3], view.nodePos[a * 3 + 1], view.nodePos[a * 3 + 2])
      attrs.aB.setXYZ(k, view.nodePos[b * 3], view.nodePos[b * 3 + 1], view.nodePos[b * 3 + 2])
      attrs.aP1.setXYZW(k, s.strands[o + 2], s.strands[o + 3], s.strands[o + 4], s.strands[o + 5])
      attrs.aP2.setXYZW(k, s.strands[o + 6], s.strands[o + 7], s.strands[o + 8], s.strands[o + 9])
      const id = s.strandIds[i]
      attrs.aP3.setXYZW(k, s.strands[o + 10], s.strands[o + 11], s.strands[o + 13], view.selected.has(id) ? 1 : view.hover === id ? 0.5 : 0)
      k++
    }
    // Potential strands: a faint silver connection that flickers between a light and a dark
    // close enough to join, brightest when their rhythms happen to align.
    if (s.nodeIds.length <= 140 && !view.sight) {
      const reach = envOf(s.env as never).formDist * 1.5
      const linked = new Set<number>()
      for (let i = 0; i < s.strandIds.length; i++) {
        const a = s.strands[i * STRAND_STRIDE]
        const b = s.strands[i * STRAND_STRIDE + 1]
        linked.add(a * 4096 + b)
        linked.add(b * 4096 + a)
      }
      let ghosts = 0
      for (let i = 0; i < s.nodeIds.length && ghosts < 40; i++) {
        if (s.nodes[i * NODE_STRIDE + 6] !== 1) continue
        for (let j = 0; j < s.nodeIds.length && ghosts < 40; j++) {
          if (s.nodes[j * NODE_STRIDE + 6] !== 0 || linked.has(i * 4096 + j)) continue
          const dx = view.nodePos[i * 3] - view.nodePos[j * 3]
          const dy = view.nodePos[i * 3 + 1] - view.nodePos[j * 3 + 1]
          const dz = view.nodePos[i * 3 + 2] - view.nodePos[j * 3 + 2]
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (d > reach || k >= attrs.aA.count) continue
          const align = Math.pow(Math.max(0, Math.cos(s.nodes[i * NODE_STRIDE + 5] - s.nodes[j * NODE_STRIDE + 5])), 6)
          const alpha = align * (1 - d / reach) * 0.55
          if (alpha < 0.02) continue
          attrs.aA.setXYZ(k, view.nodePos[i * 3], view.nodePos[i * 3 + 1], view.nodePos[i * 3 + 2])
          attrs.aB.setXYZ(k, view.nodePos[j * 3], view.nodePos[j * 3 + 1], view.nodePos[j * 3 + 2])
          attrs.aP1.setXYZW(k, 0, -0.5, 0, 0)
          attrs.aP2.setXYZW(k, 0, 0, 0, 0)
          attrs.aP3.setXYZW(k, alpha, 7, -1, 0)
          k++
          ghosts++
        }
      }
    }
    g.instanceCount = k
    for (const at of Object.values(attrs)) at.needsUpdate = true
  })

  return <primitive object={mesh.mesh} />
}
