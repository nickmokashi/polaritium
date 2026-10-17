import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { LIMITS } from '@core/sim/constants'
import { FRAG_STRIDE, SEG_STRIDE } from '@core/sim/snapshot'
import { FOG, LIGHTS, NOISE } from './glsl'
import { makeInstanced, setSegment, setTRS, touch } from './instancing'
import { uniforms, useView, type ViewState } from './shared'

// Crystal facets: glassy prisms along each grown segment. Edges catch a thin iridescence;
// growing tips glow; strain shows as warm cracks; drifting shards are what broke away.

const VERT = /* glsl */ `
attribute vec4 aC; // stress, growing, crystal, thick
varying vec3 vWorld; varying vec3 vObj; varying vec4 vC; varying float vDist;
void main(){
  vC = aC; vObj = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp; vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
uniform float uTime; uniform float uSight;
${NOISE}
${LIGHTS}
${FOG}
varying vec3 vWorld; varying vec3 vObj; varying vec4 vC; varying float vDist;
void main(){
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(cameraPosition - vWorld);
  if (dot(n,v) < 0.0) n = -n;
  float ndv = max(dot(n,v),0.0);
  float fres = pow(1.0-ndv, 3.0);
  vec3 r = reflect(-v, n);
  float env = smoothstep(-0.2, 1.0, r.y)*0.5 + 0.05;
  vec3 irid = 0.5 + 0.5*cos(6.2831*(fres*1.3 + vec3(0.0, 0.33, 0.67)));
  vec3 lit = litBy(vWorld, n, v, 120.0, 2.5);
  vec3 col = vec3(0.07,0.08,0.1) + vec3(0.75,0.8,0.88)*env*0.6 + lit*vec3(0.5,0.55,0.6) + mix(vec3(0.85), irid, 0.35)*fres*0.9;
  float tip = vC.y * smoothstep(0.1, 0.5, vObj.y);
  col += vec3(0.9,0.95,1.0)*tip*(0.8 + 0.4*sin(uTime*3.0 + vC.z));
  float crack = smoothstep(0.75, 0.95, abs(snoise(vObj*vec3(4.0,9.0,4.0) + vC.z)))*smoothstep(0.3, 1.0, vC.x);
  col = mix(col, vec3(1.0,0.72,0.4)*1.6, crack);
  col *= mix(1.0, 0.45, uSight);
  gl_FragColor = vec4(applyFog(col, vDist*0.6), 0.88 + fres*0.12);
}`

export function CrystalsLayer() {
  const view = useView()
  const layers = useMemo(() => {
    const prism = new THREE.CylinderGeometry(0.55, 1, 1, 6, 1).toNonIndexed()
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      uniforms: { uTime: uniforms.uTime, uSight: uniforms.uSight, uLights: view.u.uLights, uLightCount: view.u.uLightCount, uFogColor: uniforms.uFogColor, uFogDensity: uniforms.uFogDensity }
    })
    const segs = makeInstanced(prism, mat, LIMITS.crystalSegments, { aC: 4 })
    const shard = new THREE.OctahedronGeometry(0.6, 0).toNonIndexed()
    const frags = makeInstanced(shard, mat, LIMITS.fragments, { aC: 4 })
    segs.mesh.renderOrder = 3
    return { segs, frags }
  }, [])

  useFrame(() => {
    const s = view.snap
    if (!s) return
    const n = s.segs.length / SEG_STRIDE
    for (let i = 0; i < n; i++) {
      const o = i * SEG_STRIDE
      const sel = view.selected.has(s.segCrystal[i]) ? 0.25 : 0
      setSegment(layers.segs, i, s.segs[o], s.segs[o + 1], s.segs[o + 2], s.segs[o + 3], s.segs[o + 4], s.segs[o + 5], Math.max(0.12, s.segs[o + 6]) * (1 + sel))
      layers.segs.attrs.aC.setXYZW(i, s.segs[o + 7], s.segs[o + 9], s.segs[o + 8] * 1.7, s.segs[o + 6])
    }
    layers.segs.mesh.count = n
    touch(layers.segs)
    const f = s.fragments.length / FRAG_STRIDE
    const t = performance.now() * 0.001
    const q = new THREE.Quaternion()
    for (let i = 0; i < f; i++) {
      const o = i * FRAG_STRIDE
      q.setFromEuler(new THREE.Euler(t * 0.7 + i, t * 0.5 + i * 2, 0))
      setTRS(layers.frags, i, s.fragments[o], s.fragments[o + 1], s.fragments[o + 2], 0.5 + Math.min(1, s.fragments[o + 3] * 0.1), 1.3, 0.5, q)
      layers.frags.attrs.aC.setXYZW(i, 0, 0, i, 0.5)
    }
    layers.frags.mesh.count = f
    touch(layers.frags)
  })

  return (
    <group>
      <primitive object={layers.segs.mesh} />
      <primitive object={layers.frags.mesh} />
    </group>
  )
}
