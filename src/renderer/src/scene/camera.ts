import CameraControls from 'camera-controls'
import * as THREE from 'three'
import type { CameraPose } from '@core/app/bridge'

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2,
    Vector3: THREE.Vector3,
    Vector4: THREE.Vector4,
    Quaternion: THREE.Quaternion,
    Matrix4: THREE.Matrix4,
    Spherical: THREE.Spherical,
    Box3: THREE.Box3,
    Sphere: THREE.Sphere,
    Raycaster: THREE.Raycaster
  }
})

// One camera for the whole game: orbit with the right button, pan with the middle button
// (or Shift + right), zoom toward the pointer with the wheel, fly with W A S D and Q E, focus,
// follow, step back to the previous view, and a slow cinematic drift.

export const cam = {
  controls: null as CameraControls | null,
  follow: null as number | null,
  cinematic: false,
  history: [] as CameraPose[],
  orbitSpeed: 1,
  flySpeed: 1,
  zoomSpeed: 1,
  invertY: false
}

export function attachControls(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraControls {
  cam.controls?.dispose()
  const c = new CameraControls(camera, dom)
  c.mouseButtons.left = CameraControls.ACTION.NONE
  c.mouseButtons.right = CameraControls.ACTION.ROTATE
  c.mouseButtons.middle = CameraControls.ACTION.TRUCK
  c.mouseButtons.wheel = CameraControls.ACTION.DOLLY
  c.touches.one = CameraControls.ACTION.TOUCH_ROTATE
  c.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK
  c.dollyToCursor = true
  c.smoothTime = 0.28
  c.draggingSmoothTime = 0.1
  c.minDistance = 2.5
  c.maxDistance = 320
  c.azimuthRotateSpeed = cam.orbitSpeed
  c.polarRotateSpeed = cam.orbitSpeed * (cam.invertY ? -1 : 1)
  c.dollySpeed = cam.zoomSpeed
  cam.controls = c
  return c
}

export function applyControlSettings(s: { orbitSpeed: number; flySpeed: number; zoomSpeed: number; invertY: boolean }): void {
  cam.orbitSpeed = s.orbitSpeed
  cam.flySpeed = s.flySpeed
  cam.zoomSpeed = s.zoomSpeed
  cam.invertY = s.invertY
  const c = cam.controls
  if (!c) return
  c.azimuthRotateSpeed = s.orbitSpeed
  c.polarRotateSpeed = s.orbitSpeed * (s.invertY ? -1 : 1)
  c.dollySpeed = s.zoomSpeed
}

export function currentPose(): CameraPose | null {
  const c = cam.controls
  if (!c) return null
  const p = new THREE.Vector3()
  const t = new THREE.Vector3()
  c.getPosition(p)
  c.getTarget(t)
  return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }
}

export function setPose(pose: CameraPose, smooth = true): void {
  cam.controls?.setLookAt(...pose.position, ...pose.target, smooth)
}

export function remember(): void {
  const p = currentPose()
  if (p) {
    cam.history.push(p)
    if (cam.history.length > 30) cam.history.shift()
  }
}

export function goBack(): boolean {
  const p = cam.history.pop()
  if (!p) return false
  cam.follow = null
  setPose(p, true)
  return true
}

export function focusOn(p: THREE.Vector3, radius: number): void {
  const c = cam.controls
  if (!c) return
  remember()
  const pos = new THREE.Vector3()
  c.getPosition(pos)
  const dir = pos.clone().sub(p).normalize()
  const d = Math.max(7, radius * 7)
  c.setLookAt(p.x + dir.x * d, p.y + dir.y * d, p.z + dir.z * d, p.x, p.y, p.z, true)
}

/** Per-frame: flying keys, following, cinematic drift. */
export function driveCamera(dt: number, keys: Set<string>, followPos: THREE.Vector3 | null, reduceMotion: boolean): void {
  const c = cam.controls
  if (!c) return
  const sp = 22 * cam.flySpeed * dt * (keys.has('shift') ? 2.5 : 1)
  if (keys.has('w')) c.forward(sp, true)
  if (keys.has('s')) c.forward(-sp, true)
  if (keys.has('a')) c.truck(-sp, 0, true)
  if (keys.has('d')) c.truck(sp, 0, true)
  if (keys.has('e')) c.truck(0, -sp, true)
  if (keys.has('q')) c.truck(0, sp, true)
  if (followPos) c.moveTo(followPos.x, followPos.y, followPos.z, true)
  if (cam.cinematic) c.rotate(dt * (reduceMotion ? 0.02 : 0.06), Math.sin(performance.now() * 0.0001) * dt * 0.01, true)
  c.update(dt)
}
