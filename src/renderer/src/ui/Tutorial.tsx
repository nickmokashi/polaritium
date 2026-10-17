import { useEffect, useRef, useState } from 'react'
import { NODE_STRIDE, STRAND_STRIDE } from '@core/sim/snapshot'
import { bridge } from '../bridge'
import { cam } from '../scene/camera'
import { view } from '../scene/shared'
import { useUI } from '../state/store'
import { Btn } from './primitives'

// A first-use guide that teaches by doing. Each step waits for the real thing to happen in the
// simulation (not a click on "Next"), then moves on. It can be skipped at any point.

interface Step {
  text: string
  done: (ctx: { moved: boolean; events: Set<string> }) => boolean
}

function nodeKinds(): { white: number[]; black: number[] } {
  const s = view.snap
  const out = { white: [] as number[], black: [] as number[] }
  if (!s) return out
  for (let i = 0; i < s.nodeIds.length; i++) {
    const k = s.nodes[i * NODE_STRIDE + 6]
    if (k === 1) out.white.push(i)
    if (k === 0) out.black.push(i)
  }
  return out
}

const STEPS: Step[] = [
  { text: 'Look around: drag with the right mouse button, or drag empty space with the left. Use the wheel to come closer.', done: (c) => c.moved },
  { text: 'Touch the light: click the bright concentration with the Hand.', done: () => useUI.getState().selection.some((id) => { const i = view.nodeIndex.get(id); return i !== undefined && view.snap?.nodes[i * NODE_STRIDE + 6] === 1 }) },
  { text: 'Pull it toward the dark: drag the light closer to the dark one and let go.', done: (c) => c.events.has('strandFormed') || c.events.has('connect') || closeEnough() },
  { text: 'Connect them: press 3 for the Strand, then drag from the light to the dark.', done: () => hasStrand() },
  { text: 'Energy now flows along the strand, from light to dark. Press Tab for Strand Sight to see the network. Press Tab again to return.', done: (c) => c.events.has('sight') },
  { text: 'Bring them into step: press 7 for Tune, then drag sideways on the dark one until its rhythm matches the light’s. Watch the strand brighten as they lock.', done: () => locked() },
  { text: 'Disturb it: press 6 for Pulse and click near them. Hold the button longer for a stronger pulse.', done: (c) => c.events.has('pulse') },
  { text: 'That is everything you need. The rest is yours to discover. H shows all the controls; the Discovery Atlas records what you find.', done: () => false }
]

function closeEnough(): boolean {
  const s = view.snap
  if (!s) return false
  const k = nodeKinds()
  for (const a of k.white) for (const b of k.black) {
    const d = Math.hypot(s.nodes[a * NODE_STRIDE] - s.nodes[b * NODE_STRIDE], s.nodes[a * NODE_STRIDE + 1] - s.nodes[b * NODE_STRIDE + 1], s.nodes[a * NODE_STRIDE + 2] - s.nodes[b * NODE_STRIDE + 2])
    if (d < 18) return true
  }
  return false
}
function hasStrand(): boolean {
  return (view.snap?.strandIds.length ?? 0) > 0
}
function locked(): boolean {
  const s = view.snap
  if (!s) return false
  for (let i = 0; i < s.strandIds.length; i++) if (s.strands[i * STRAND_STRIDE + 7] > 0.6) return true
  return false
}

export function Tutorial() {
  const settings = useUI((s) => s.settings)
  const spec = useUI((s) => s.spec)
  const sight = useUI((s) => s.sight)
  const [step, setStep] = useState(0)
  const events = useRef(new Set<string>())
  const startPose = useRef<string | null>(null)
  const active = !settings.tutorialDone && spec?.mode === 'lab' && spec.preset === 'twin' && !spec.loadState

  useEffect(() => {
    if (sight) events.current.add('sight')
  }, [sight])

  useEffect(() => {
    if (!active) return
    const host = view.host
    const prev = host?.onEvents
    if (host) {
      host.onEvents = (ev) => {
        prev?.(ev)
        for (const e of ev) events.current.add(e.type)
      }
    }
    const t = setInterval(() => {
      const p = new Float32Array(3)
      const c = cam.controls
      if (c) {
        const az = c.azimuthAngle.toFixed(2) + c.polarAngle.toFixed(2) + c.distance.toFixed(0)
        if (startPose.current === null) startPose.current = az
        const moved = startPose.current !== az
        void p
        setStep((s) => (s < STEPS.length - 1 && STEPS[s].done({ moved, events: events.current }) ? s + 1 : s))
      }
    }, 300)
    return () => {
      clearInterval(t)
      if (host && prev) host.onEvents = prev
    }
  }, [active])

  if (!active) return null
  const finish = async () => {
    const s = await bridge.settings.set({ ...useUI.getState().settings, tutorialDone: true })
    useUI.getState().set({ settings: s })
  }
  return (
    <div className="panel fade-in" style={{ position: 'absolute', left: '50%', bottom: 74, transform: 'translateX(-50%)', width: 520, padding: '12px 16px', zIndex: 25 }} data-testid="tutorial">
      <div className="row">
        <span className="caps">
          First steps · {step + 1} of {STEPS.length}
        </span>
        <div className="spacer" />
        <Btn small kind="ghost" onClick={() => void finish()} title="Close the guide; it will not appear again">
          {step === STEPS.length - 1 ? 'Done' : 'Skip'}
        </Btn>
      </div>
      <div style={{ marginTop: 6, lineHeight: 1.45, fontSize: '1.05em' }} data-testid="tutorial-text">
        {STEPS[step].text}
      </div>
    </div>
  )
}
