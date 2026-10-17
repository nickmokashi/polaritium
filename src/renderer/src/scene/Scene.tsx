import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { envOf } from '@core/sim/environments'
import { NODE_STRIDE } from '@core/sim/snapshot'
import type { EnvId } from '@core/sim/types'
import { audio } from '../audio/engine'
import { useUI } from '../state/store'
import { attachControls, cam, setPose } from './camera'
import { CrystalsLayer } from './CrystalsLayer'
import { EnvironmentLayer } from './EnvironmentLayer'
import { FieldLayer } from './FieldLayer'
import { FxLayer } from './FxLayer'
import { Interaction, ix } from './Interaction'
import { NodesLayer } from './NodesLayer'
import { OrganismsLayer } from './OrganismsLayer'
import { StrandsLayer } from './StrandsLayer'
import { StructuresLayer } from './StructuresLayer'
import { uniforms, updateView, useView, view as defaultView, ViewContext, type ViewState } from './shared'
import type { CameraPose } from '@core/app/bridge'

// The 3D view. The Updater runs first each frame: it paces the simulation, eases positions,
// picks the lights, and feeds the voices. Then every layer draws from the same snapshot.

export interface CaptureRequest {
  width: number
  height: number
  resolve: (dataUrl: string) => void
}

export const capture = { pending: null as CaptureRequest | null }

function Updater({ interactive }: { interactive: boolean }) {
  const view = useView()
  const lastVoices = useRef(0)
  useFrame((state, dt) => {
    const h = view.host
    if (!h) return
    h.frame(dt)
    const reduce = view.reduceMotion
    uniforms.uTime.value += dt * (reduce ? 0.5 : 1)
    uniforms.uSight.value += ((view.sight ? 1 : 0) - uniforms.uSight.value) * Math.min(1, dt * 6)
    uniforms.uLens.value = view.lens ? 1 : 0
    uniforms.uFlashLimit.value = view.reduceFlashing ? 0.25 : 1
    updateView(view, dt)
    const now = performance.now()
    const s = view.snap
    if (interactive && s && now - lastVoices.current > 120) {
      lastVoices.current = now
      const camPos = state.camera.position
      const list: { freq: number; gain: number; pan: number; kind: number; d: number }[] = []
      const v = new THREE.Vector3()
      for (let i = 0; i < s.nodeIds.length; i++) {
        const o = i * NODE_STRIDE
        v.set(view.nodePos[i * 3], view.nodePos[i * 3 + 1], view.nodePos[i * 3 + 2])
        const d = v.distanceTo(camPos)
        const fill = s.nodes[o + 4]
        const gain = (0.2 + fill) * Math.min(1, 40 / (d + 5)) * (1 + s.nodes[o + 8])
        const pv = v.clone().project(state.camera)
        list.push({ freq: s.nodes[o + 9], gain, pan: pv.x, kind: s.nodes[o + 6], d })
      }
      list.sort((a, b) => b.gain - a.gain)
      audio.setVoices(list.slice(0, 6))
    }
  }, -2)
  return null
}

function Preview() {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xdfe3ee, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.8 }))
    l.frustumCulled = false
    return l
  }, [])
  const sphere = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0x9aa2b6, wireframe: true, transparent: true, opacity: 0.25 }))
    m.frustumCulled = false
    return m
  }, [])
  const ghost = useMemo(() => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }))
    m.frustumCulled = false
    return m
  }, [])
  useFrame(() => {
    line.visible = !!ix.line
    if (ix.line) {
      const p = line.geometry.attributes.position as THREE.BufferAttribute
      p.setXYZ(0, ix.line.a.x, ix.line.a.y, ix.line.a.z)
      p.setXYZ(1, ix.line.b.x, ix.line.b.y, ix.line.b.z)
      p.needsUpdate = true
      line.computeLineDistances()
    }
    sphere.visible = !!ix.sphere
    if (ix.sphere) {
      sphere.position.copy(ix.sphere.c)
      sphere.scale.setScalar(ix.sphere.r)
    }
    const ui = useUI.getState()
    ghost.visible = !!ix.ghost && ui.tool === 'seed'
    if (ix.ghost) {
      ghost.position.copy(ix.ghost)
      ghost.scale.setScalar(1.1 * Math.cbrt(ui.seedMass))
    }
  })
  return (
    <group>
      <primitive object={line} />
      <primitive object={sphere} />
      <primitive object={ghost} />
    </group>
  )
}

function Capturer({ composer }: { composer: React.MutableRefObject<any> }) {
  const { gl, scene, camera, size } = useThree()
  useFrame(() => {
    const req = capture.pending
    if (!req) return
    capture.pending = null
    const cvs = gl.domElement
    const prevW = size.width
    const prevH = size.height
    const prevRatio = gl.getPixelRatio()
    const persp = camera as THREE.PerspectiveCamera
    const prevAspect = persp.aspect
    try {
      gl.setPixelRatio(1)
      gl.setSize(req.width, req.height, false)
      persp.aspect = req.width / req.height
      persp.updateProjectionMatrix()
      const comp = composer.current
      if (comp) {
        comp.setSize(req.width, req.height)
        comp.render(0.016)
      } else gl.render(scene, camera)
      req.resolve(cvs.toDataURL('image/png'))
    } finally {
      gl.setPixelRatio(prevRatio)
      gl.setSize(prevW, prevH, false)
      composer.current?.setSize(prevW, prevH)
      persp.aspect = prevAspect
      persp.updateProjectionMatrix()
    }
  }, 2)
  return null
}

function CameraSetup({ pose, radius }: { pose: CameraPose | null; radius: number }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    const c = attachControls(camera as THREE.PerspectiveCamera, gl.domElement)
    if (pose) setPose(pose, false)
    else c.setLookAt(0, radius * 0.16, radius * 0.6, 0, 0, 0, false)
    return () => {
      c.dispose()
      if (cam.controls === c) cam.controls = null
    }
  }, [camera, gl])
  return null
}

function MenuCamera() {
  useFrame((_, dt) => {
    cam.controls?.rotate(dt * 0.04, 0, true)
    cam.controls?.update(dt)
  })
  return null
}

export function Scene({ env, interactive, pose, viewState }: { env: EnvId; interactive: boolean; pose: CameraPose | null; viewState?: ViewState }) {
  const settings = useUI((s) => s.settings)
  const view = viewState ?? defaultView
  const e = envOf(env)
  useEffect(() => {
    uniforms.uFogDensity.value = e.look.fog
    view.dustCount = settings.graphics.dust
    view.reduceMotion = settings.access.reduceMotion
    view.reduceFlashing = settings.access.reduceFlashing
  }, [env, settings])
  const g = settings.graphics
  const composer = useRef<any>(null)
  return (
    <Canvas
      dpr={[g.resolution * 0.75, g.resolution]}
      gl={{ antialias: g.quality !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false }}
      camera={{ fov: 52, near: 0.1, far: 2000, position: [0, 15, 60] }}
      frameloop="always"
      onCreated={({ gl }) => {
        gl.setClearColor(0x050506)
        gl.toneMapping = THREE.NoToneMapping
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ViewContext.Provider value={view}>
      <Updater interactive={interactive} />
      <CameraSetup pose={pose} radius={e.radius} />
      {!interactive && <MenuCamera />}
      <EnvironmentLayer env={env} />
      <FieldLayer />
      <NodesLayer />
      <CrystalsLayer />
      <OrganismsLayer />
      <StrandsLayer />
      <StructuresLayer />
      <FxLayer />
      {interactive && <Preview />}
      {interactive && <Interaction />}
      <Capturer composer={composer} />
      </ViewContext.Provider>
      {g.bloom ? (
        <EffectComposer ref={composer} multisampling={0}>
          <Bloom mipmapBlur intensity={1.3} luminanceThreshold={0.5} luminanceSmoothing={0.3} radius={0.78} />
          <Vignette offset={0.28} darkness={0.72} />
          <Noise opacity={0.035} premultiply />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : (
        <EffectComposer ref={composer} multisampling={0}>
          <Vignette offset={0.28} darkness={0.7} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  )
}
