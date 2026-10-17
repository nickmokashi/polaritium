import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { envOf } from '@core/sim/environments'
import type { EnvId } from '@core/sim/types'
import { NOISE } from './glsl'
import { uniforms, useView, type ViewState } from './shared'

// Each environment's surroundings. The Cathedral's pillars glow where the signal field
// reaches them, the Garden's slabs crack with light as quakes pass, the Well's basin ripples
// with the real vibration below, and the Threshold's divide moves with the simulation.

const SKY_VERT = /* glsl */ `
varying vec3 vDir; varying vec3 vW;
void main(){ vDir = normalize(position); vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`
const SKY_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uTint; uniform float uSplit; uniform float uPlane; uniform float uBright;
${NOISE}
varying vec3 vDir; varying vec3 vW;
void main(){
  float n = snoise(vDir*2.2 + vec3(0.0, uTime*0.004, 0.0))*0.5+0.5;
  float n2 = snoise(vDir*6.0 - uTime*0.003)*0.5+0.5;
  float neb = pow(n, 3.0)*0.6 + pow(n2, 6.0)*0.25;
  vec3 col = vec3(0.006,0.006,0.008) + uTint*neb*0.06*uBright;
  col += uTint*0.012*(1.0 - abs(vDir.y));
  if (uSplit > 0.5) {
    float side = smoothstep(-8.0, 8.0, vW.x - uPlane*6.0);
    col = mix(col*0.4, col + vec3(0.11,0.105,0.1)*(0.6 + 0.4*n), side);
  }
  gl_FragColor = vec4(col, 1.0);
}`

const DECOR_VERT = /* glsl */ `
uniform float uHalf; uniform sampler3D uSig;
varying vec3 vN; varying vec3 vW; varying float vSig; varying vec3 vObj;
void main(){
  vObj = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix*instanceMatrix)*normal);
  vec3 uvw = clamp((wp.xyz + uHalf)/(2.0*uHalf), 0.0, 1.0);
  vSig = texture(uSig, uvw).r*2.0 - 1.0;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`
const DECOR_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uTint; uniform float uMode; uniform float uSight;
${NOISE}
varying vec3 vN; varying vec3 vW; varying float vSig; varying vec3 vObj;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = normalize(cameraPosition - vW);
  if (dot(n,v) < 0.0) n = -n;
  float ndv = max(dot(n,v), 0.0);
  float fres = pow(1.0-ndv, 3.0);
  vec3 r = reflect(-v, n);
  float env = smoothstep(-0.4, 1.0, r.y)*0.4;
  vec3 col = vec3(0.02,0.021,0.025) + uTint*(env*0.18 + fres*0.25);
  float s = abs(vSig);
  if (uMode < 1.5) col += vec3(0.75,0.8,0.95)*smoothstep(0.08, 0.8, s)*0.9*(0.6 + 0.4*fres);
  else { float crack = smoothstep(0.8, 0.97, abs(snoise(vObj*vec3(1.5,3.0,1.5)))); col += vec3(1.0,0.8,0.55)*crack*smoothstep(0.05, 0.6, s)*1.6; }
  col *= mix(1.0, 0.25, uSight);
  float dist = length(vW - cameraPosition);
  col *= exp(-dist*0.004);
  gl_FragColor = vec4(col, 1.0);
}`

const BASIN_VERT = /* glsl */ `
uniform float uHalf; uniform sampler3D uSig; uniform float uDepth;
varying vec3 vW; varying float vSig; varying float vR;
void main(){
  vec3 p = position;
  float r = length(p.xz); vR = r;
  p.y = -uDepth + r*r*0.004;
  vec3 uvw = clamp((p + vec3(0.0, 8.0, 0.0) + uHalf)/(2.0*uHalf), 0.0, 1.0);
  float s = texture(uSig, uvw).r*2.0-1.0;
  p.y += s*2.0;
  vSig = s; vW = p;
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
}`
const BASIN_FRAG = /* glsl */ `
uniform float uTime; uniform float uSight;
varying vec3 vW; varying float vSig; varying float vR;
void main(){
  vec3 dx = dFdx(vW); vec3 dy = dFdy(vW);
  vec3 n = normalize(cross(dx, dy)); if (n.y < 0.0) n = -n;
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n,v),0.0), 4.0);
  vec3 col = vec3(0.01,0.011,0.013) + vec3(0.55,0.6,0.7)*fres*0.6 + vec3(0.7,0.75,0.9)*smoothstep(0.05,0.5,abs(vSig))*0.35;
  float rings = smoothstep(0.96, 1.0, sin(vR*0.9 - uTime*0.4)*0.5+0.5)*0.05;
  col += rings;
  col *= mix(1.0, 0.3, uSight);
  col *= exp(-length(vW - cameraPosition)*0.006);
  gl_FragColor = vec4(col, 1.0);
}`

const PLANE_VERT = /* glsl */ `
uniform float uPlane;
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec3 p = position; p.x += uPlane; vW = p; gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0); }`
const PLANE_FRAG = /* glsl */ `
uniform float uTime;
${NOISE}
varying vec2 vUv; varying vec3 vW;
void main(){
  float n = snoise(vec3(vW.yz*0.05, uTime*0.1))*0.5+0.5;
  float edge = 1.0 - smoothstep(0.35, 0.5, length(vUv-0.5));
  vec3 col = vec3(0.85,0.85,0.9)*(0.04 + 0.06*n)*edge;
  gl_FragColor = vec4(col, edge*0.6);
}`

function decorMaterial(mode: number, tint: THREE.Color, view: ViewState): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DECOR_VERT,
    fragmentShader: DECOR_FRAG,
    uniforms: { uTime: uniforms.uTime, uHalf: view.u.uFieldHalf, uSig: { get value() { return view.u.uSignal.value } }, uTint: { value: tint }, uMode: { value: mode }, uSight: uniforms.uSight }
  })
}

export function EnvironmentLayer({ env }: { env: EnvId }) {
  const view = useView()
  const e = envOf(env)
  const tint = useMemo(() => new THREE.Color(...e.look.tint), [env])
  const sky = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: uniforms.uTime, uTint: { value: tint }, uSplit: { value: env === 'threshold' ? 1 : 0 }, uPlane: view.u.uPlane, uBright: { value: env === 'cathedral' ? 1.6 : 1 } }
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), m)
    mesh.renderOrder = -10
    mesh.frustumCulled = false
    return mesh
  }, [env, tint])

  const decor = useMemo(() => {
    const group = new THREE.Group()
    const R = e.radius
    if (env === 'cathedral') {
      const geo = new THREE.CylinderGeometry(1, 1.25, 1, 6, 1).toNonIndexed()
      const n = 18
      const inst = new THREE.InstancedMesh(geo, decorMaterial(1, tint, view), n)
      const m = new THREE.Matrix4()
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const h = 70 + (i % 3) * 22
        m.compose(new THREE.Vector3(Math.cos(a) * (R + 6), -R * 0.6 + h / 2, Math.sin(a) * (R + 6)), new THREE.Quaternion(), new THREE.Vector3(2.4 + (i % 2), h, 2.4 + (i % 2)))
        inst.setMatrixAt(i, m)
      }
      inst.frustumCulled = false
      group.add(inst)
      const floor = new THREE.Mesh(new THREE.CircleGeometry(R * 1.6, 96), new THREE.MeshBasicMaterial({ color: 0x0a0b0e }))
      floor.rotation.x = -Math.PI / 2
      floor.position.y = -R * 0.62
      group.add(floor)
    } else if (env === 'garden') {
      const geo = new THREE.DodecahedronGeometry(1, 0).toNonIndexed()
      const n = 46
      const inst = new THREE.InstancedMesh(geo, decorMaterial(2, tint, view), n)
      const m = new THREE.Matrix4()
      let s = 99
      const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2
        const r = R * (0.75 + rnd() * 0.6)
        const y = -R * 0.55 + rnd() * R * 0.4 - 6
        m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), new THREE.Vector3(3 + rnd() * 8, 0.8 + rnd() * 2, 2 + rnd() * 6))
        inst.setMatrixAt(i, m)
      }
      inst.frustumCulled = false
      group.add(inst)
    } else if (env === 'well') {
      const geo = new THREE.PlaneGeometry(R * 3.2, R * 3.2, 140, 140)
      geo.rotateX(-Math.PI / 2)
      const m = new THREE.ShaderMaterial({
        vertexShader: BASIN_VERT,
        fragmentShader: BASIN_FRAG,
        uniforms: { uTime: uniforms.uTime, uHalf: view.u.uFieldHalf, uSig: { get value() { return view.u.uSignal.value } }, uDepth: { value: R * 0.75 }, uSight: uniforms.uSight }
      })
      const mesh = new THREE.Mesh(geo, m)
      mesh.frustumCulled = false
      group.add(mesh)
    } else if (env === 'threshold') {
      const m = new THREE.ShaderMaterial({ vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime, uPlane: view.u.uPlane } })
      const geo = new THREE.PlaneGeometry(R * 2.4, R * 2.4)
      geo.rotateY(Math.PI / 2)
      const mesh = new THREE.Mesh(geo, m)
      mesh.frustumCulled = false
      mesh.renderOrder = 10
      group.add(mesh)
    }
    return group
  }, [env, tint])

  useFrame(() => {
    view.u.uRadius.value = e.radius
  })

  return (
    <group>
      <primitive object={sky} />
      <primitive object={decor} />
    </group>
  )
}
