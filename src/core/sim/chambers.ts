import { ANCHOR_ENERGY, ANCHOR_POS, TICKS_PER_SECOND } from './constants'
import { growInstant, nucleate } from './crystals'
import { envOf, thresholdPlane } from './environments'
import { pulseField } from './field'
import { TAU } from './math'
import { ARCHETYPES, spawnOrganism } from './organisms'
import type { ChamberState, EnvId, SimNode, WorldState } from './types'
import { addNode, addStrand, capacity, createWorld, fill } from './world'

// Paradox Chambers: curated questions with mechanically checked answers. Each chamber sets up
// a small universe, may drive it (a drummer, a quake), and checks a measurable condition every
// tick. Failing is never a dead end: the note says what the simulation saw.

export type ToolId = 'hand' | 'seed' | 'strand' | 'pull' | 'twist' | 'pulse' | 'tune' | 'fracture' | 'fuse' | 'veil' | 'lens' | 'anchor'

export interface ChamberDef {
  id: string
  num: number
  title: string
  goal: string
  env: EnvId
  tools: ToolId[]
  hints: string[]
  setup(w: WorldState): void
  drive?(w: WorldState, st: ChamberState): void
  check(w: WorldState, st: ChamberState): { progress: number; done?: boolean; note?: string; failed?: string }
}

const S = TICKS_PER_SECOND
const memo = (st: ChamberState, k: string, v?: number) => {
  if (v !== undefined) st.memo[k] = v
  return st.memo[k] ?? 0
}
const nodeOf = (w: WorldState, id: number) => w.nodes.find((n) => n.id === id)
const hold = (st: ChamberState, ok: boolean, need: number) => {
  st.held = ok ? st.held + 1 : 0
  return Math.min(1, st.held / need)
}

function mk(w: WorldState, kind: SimNode['kind'], x: number, y: number, z: number, o: Parameters<typeof addNode>[3] = {}): SimNode {
  const n = addNode(w, kind, { x, y, z }, o)!
  w.acct.external += n.energy
  return n
}

export const CHAMBERS: ChamberDef[] = [
  {
    id: 'still-motion',
    num: 1,
    title: 'Still Motion',
    goal: 'Make the light circle the dark, steadily, for twenty seconds.',
    env: 'cradle',
    tools: ['hand', 'strand', 'twist', 'tune', 'lens', 'anchor'],
    hints: ['Throwing it only works for a while: the dark slows everything down.', 'A twisted strand turns its ends while energy flows through it.', 'Twist the strand between them a quarter turn or more.'],
    setup(w) {
      const B = mk(w, 'black', 0, 0, 0, { mass: 2, freq: 0.3 })
      B.anchor = ANCHOR_POS | ANCHOR_ENERGY
      B.energy = 0
      B.anchorEnergy = 0
      const W = mk(w, 'white', 12, 0, 0, { mass: 1, freq: 0.5 })
      addStrand(w, W.id, B.id, { origin: 'preset' })
      w.chamber!.memo.w = W.id
      w.chamber!.memo.b = B.id
    },
    check(w, st) {
      const W = nodeOf(w, memo(st, 'w'))
      const B = nodeOf(w, memo(st, 'b'))
      if (!W || !B) return { progress: 0, failed: 'One of the two is gone.' }
      const rx = W.p.x - B.p.x
      const ry = W.p.y - B.p.y
      const rz = W.p.z - B.p.z
      const d = Math.hypot(rx, ry, rz) || 1
      const sp = Math.hypot(W.v.x, W.v.y, W.v.z)
      const radial = Math.abs((W.v.x * rx + W.v.y * ry + W.v.z * rz) / d)
      const ok = !W.held && sp >= 1.2 && d >= 5 && d <= 25 && radial < 0.5 * sp
      const p = hold(st, ok, 20 * S)
      return { progress: p, done: p >= 1, note: ok ? 'Circling.' : sp < 1.2 ? 'It is not moving much.' : 'It is moving, but not around the dark.' }
    }
  },
  {
    id: 'delicate',
    num: 2,
    title: 'The Delicate Thing',
    goal: 'Keep the crystal whole while the drummer beats: lose no more than a third of it in sixty seconds.',
    env: 'cradle',
    tools: ['tune', 'veil', 'hand', 'lens', 'anchor'],
    hints: ['The crystal breaks when it is shaken at its own frequency.', 'The drummer beats at one rhythm. The crystal has its own. Are they close?', 'Tune the crystal away from the beat, or veil it from the vibration.'],
    setup(w) {
      const B = mk(w, 'black', 0, -4, 0, { mass: 1.6, energy: 40 })
      B.anchor = ANCHOR_POS
      const W = mk(w, 'white', 0, 14, 0, { mass: 1.2 })
      W.anchor = ANCHOR_POS
      const c = nucleate(w, envOf(w.env), B.p, B, 'hex')!
      growInstant(w, c, 36)
      c.freq = 0.9
      c.energy = 30
      w.acct.external += 30
      const drum = mk(w, 'grey', 9, -2, 4, { mass: 0.8, freq: 0.9, energy: 4 })
      drum.anchor = ANCHOR_POS
      st0(w).memo.c = c.id
      st0(w).memo.peak = c.segs.length
      st0(w).memo.drum = drum.id
    },
    drive(w, st) {
      const drum = nodeOf(w, memo(st, 'drum'))
      if (!drum) return
      const period = Math.round(S / 0.9)
      if ((w.tick - st.startedTick) % period === 0) {
        pulseField(w.field, drum.p, 2.6, 5)
        drum.glow = 1
      }
    },
    check(w, st) {
      const c = w.crystals.find((x) => x.id === memo(st, 'c'))
      const peak = memo(st, 'peak')
      const left = c ? c.segs.length / peak : 0
      if (left < 0.67) return { progress: 0, failed: 'More than a third of the crystal broke away.' }
      const t = w.tick - st.startedTick
      const p = Math.min(1, t / (60 * S))
      return { progress: p, done: p >= 1, note: `${Math.round(left * 100)}% of the crystal remains. Its resonance: ${c ? c.resonance.toFixed(2) : 0}.` }
    }
  },
  {
    id: 'heartbeat',
    num: 3,
    title: 'Heartbeat',
    goal: 'Make a flow that swings back and forth on its own, and keeps doing it for thirty seconds without you.',
    env: 'cradle',
    tools: ['tune', 'strand', 'hand', 'lens', 'anchor', 'pulse'],
    hints: ['Grey gathers energy and releases it in beats.', 'This grey is barely beating. Its rhythm is too slow.', 'Tune the grey faster, and give its strands more coupling.'],
    setup(w) {
      const W = mk(w, 'white', -12, 0, 0, { mass: 1.4, freq: 0.5 })
      const G = mk(w, 'grey', 0, 2, 0, { mass: 1, freq: 0.06, energy: 2 })
      const B = mk(w, 'black', 12, 0, 0, { mass: 1.5, freq: 0.3 })
      W.anchor = G.anchor = B.anchor = ANCHOR_POS
      addStrand(w, W.id, G.id, { coupling: 0.15, origin: 'preset' })
      addStrand(w, G.id, B.id, { coupling: 0.15, origin: 'preset' })
    },
    check(w, st) {
      const swinging = w.strands.some((s) => s.amp >= 0.6 && s.oscFreq >= 0.15)
      const untouched = w.tick - w.lastAction
      const ok = swinging
      const p = hold(st, ok, 30 * S)
      const done = p >= 1 && untouched >= 30 * S
      return { progress: done ? 1 : ok ? Math.min(p, untouched / (30 * S)) : 0, done, note: ok ? (untouched < 30 * S ? 'It is swinging. Now leave it alone.' : 'Swinging on its own.') : 'The flows are steady, not swinging.' }
    }
  },
  {
    id: 'storm',
    num: 4,
    title: 'Through the Storm',
    goal: 'Deliver sixty units of energy into the far dark through a network that keeps trying to break.',
    env: 'garden',
    tools: ['strand', 'tune', 'hand', 'anchor', 'lens', 'fuse'],
    hints: ['Strands here are brittle and the ground shakes.', 'A strand carrying too much at once overloads and snaps.', 'Use the greys as stepping stones, and keep coupling moderate.'],
    setup(w) {
      const src = mk(w, 'white', -30, 0, 0, { mass: 2.5, freq: 0.4 })
      src.anchor = ANCHOR_POS | ANCHOR_ENERGY
      src.energy = capacity(src)
      src.anchorEnergy = src.energy
      const dst = mk(w, 'black', 30, 0, 0, { mass: 2, freq: 0.4 })
      dst.anchor = ANCHOR_POS | ANCHOR_ENERGY
      dst.energy = 0
      dst.anchorEnergy = 0
      for (let i = 0; i < 3; i++) {
        const g = mk(w, 'grey', -15 + i * 15, (i % 2 ? 5 : -5), 0, { mass: 1.1, freq: 0.4, energy: 3 })
        g.anchor = ANCHOR_POS
      }
      st0(w).memo.dst = dst.id
    },
    check(w, st) {
      const dst = memo(st, 'dst')
      let inflow = 0
      for (const s of w.strands) {
        if (s.b === dst && s.current > 0) inflow += s.current
        if (s.a === dst && s.current < 0) inflow += -s.current
      }
      const got = memo(st, 'got', memo(st, 'got') + inflow / S)
      const t = w.tick - st.startedTick
      if (t > 120 * S && got < 60) return { progress: got / 60, failed: 'Two minutes passed before sixty units arrived.' }
      return { progress: Math.min(1, got / 60), done: got >= 60, note: `${got.toFixed(1)} of 60 delivered.` }
    }
  },
  {
    id: 'same-changed',
    num: 5,
    title: 'Same and Changed',
    goal: 'Grow the ring from three members to five without it ever becoming a different ring.',
    env: 'cathedral',
    tools: ['strand', 'fracture', 'hand', 'tune', 'lens', 'anchor'],
    hints: ['A ring keeps its identity while most of its members stay.', 'Open the loop at one strand and close it again through a new member.', 'New members must fall into step before the loop counts.'],
    setup(w) {
      const ids: number[] = []
      const kinds: SimNode['kind'][] = ['white', 'grey', 'black']
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3
        const n = mk(w, kinds[i], Math.cos(a) * 9, 0, Math.sin(a) * 9, { mass: 1, freq: 0.4, phase: 0 })
        ids.push(n.id)
      }
      for (let i = 0; i < 3; i++) {
        const s = addStrand(w, ids[i], ids[(i + 1) % 3], { coupling: 0.7, origin: 'preset' })!
        s.lock = 120
        s.drift = 0
      }
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3 + TAU / 6
        mk(w, 'grey', Math.cos(a) * 16, 2, Math.sin(a) * 16, { mass: 1, freq: 0.4, energy: 5 })
      }
    },
    check(w, st) {
      const first = memo(st, 'ring')
      if (!first) {
        const r = w.rings.find((x) => x.confirmed)
        if (r) memo(st, 'ring', r.id)
        return { progress: 0, note: 'Waiting for the ring to settle.' }
      }
      const r = w.rings.find((x) => x.id === first)
      if (!r) {
        if (w.ghosts.some((g) => g.ring.id === first)) return { progress: 0, note: 'The ring is open. Close it again within ten seconds and it stays itself.' }
        return { progress: 0, failed: 'The original ring was open too long. A new loop is a different ring.' }
      }
      const p = Math.min(1, Math.max(0, (r.members.length - 3) / 2))
      return { progress: p, done: r.members.length >= 5 && r.confirmed, note: `The ring has ${r.members.length} members.` }
    }
  },
  {
    id: 'unlikely-bond',
    num: 6,
    title: 'Unlikely Bond',
    goal: 'Hold the two lights together with a strand that lasts thirty seconds.',
    env: 'garden',
    tools: ['strand', 'hand', 'tune', 'pull', 'lens', 'fuse'],
    hints: ['Light pushes light away, and strands here are brittle.', 'A light pushes harder the fuller it is.', 'Let the dark drink from them first, then join them.'],
    setup(w) {
      const a = mk(w, 'white', -6, 0, 0, { mass: 2.4, freq: 0.5 })
      const b = mk(w, 'white', 6, 0, 0, { mass: 2.4, freq: 0.5 })
      a.energy = capacity(a) * 0.95
      b.energy = capacity(b) * 0.95
      w.acct.external += (capacity(a) + capacity(b)) * 0.45
      const sink = mk(w, 'black', 0, -14, 0, { mass: 2.5, freq: 0.5 })
      sink.anchor = ANCHOR_POS | ANCHOR_ENERGY
      sink.energy = 0
      sink.anchorEnergy = 0
      st0(w).memo.a = a.id
      st0(w).memo.b = b.id
    },
    check(w, st) {
      const a = memo(st, 'a')
      const b = memo(st, 'b')
      const s = w.strands.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
      if (!s) {
        st.held = 0
        return { progress: 0, note: 'The lights are not joined.' }
      }
      const p = hold(st, true, 30 * S)
      return { progress: p, done: p >= 1, note: `Joined, tension ${s.tension.toFixed(1)}.` }
    }
  },
  {
    id: 'choir',
    num: 7,
    title: 'The Choir',
    goal: 'Bring all six mediators into one rhythm and hold it for ten seconds.',
    env: 'cathedral',
    tools: ['strand', 'tune', 'hand', 'lens', 'anchor'],
    hints: ['Coupled rhythms pull each other into step, if they are close enough to begin with.', 'The Cathedral settles frequencies onto a harmonic series.', 'Connect them, and tune them toward one note.'],
    setup(w) {
      const ids: number[] = []
      const f = [0.22, 0.31, 0.43, 0.52, 0.64, 0.75]
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6
        const g = mk(w, 'grey', Math.cos(a) * 14, Math.sin(a * 2) * 2, Math.sin(a) * 14, { mass: 1, freq: f[i], energy: 5 })
        g.anchor = ANCHOR_POS | ANCHOR_ENERGY
        g.anchorEnergy = 5
        ids.push(g.id)
      }
      ids.forEach((id, i) => (st0(w).memo[`g${i}`] = id))
    },
    check(w, st) {
      let sx = 0
      let sy = 0
      let n = 0
      for (let i = 0; i < 6; i++) {
        const g = nodeOf(w, memo(st, `g${i}`))
        if (!g) continue
        sx += Math.cos(g.phase)
        sy += Math.sin(g.phase)
        n++
      }
      if (n < 6) return { progress: 0, failed: 'One of the six is gone.' }
      const r = Math.hypot(sx, sy) / 6
      const p = hold(st, r >= 0.95, 10 * S)
      return { progress: p, done: p >= 1, note: `In step: ${Math.round(r * 100)}%.` }
    }
  },
  {
    id: 'dark-garden',
    num: 8,
    title: 'Dark Garden',
    goal: 'Keep at least five of these forms alive for ninety seconds. There is no light here.',
    env: 'well',
    tools: ['hand', 'strand', 'fracture', 'pulse', 'tune', 'lens', 'fuse'],
    hints: ['They are starving, and the only energy here is held by the dark.', 'The dark keeps what it takes. What would make it let go?', 'Some of them eat vibration. And a dark that breaks scatters what it held.'],
    setup(w) {
      const B = mk(w, 'black', 0, -2, 0, { mass: 2.2 })
      B.energy = capacity(B) * 0.85
      w.acct.external += capacity(B) * 0.75
      for (let i = 0; i < 4; i++) {
        const o = spawnOrganism(w, { x: -10 + i * 5, y: 6, z: 3 }, ARCHETYPES.swimmer, null, 4)
        if (o) w.acct.external += o.energy
      }
      for (let i = 0; i < 4; i++) {
        const o = spawnOrganism(w, { x: -10 + i * 5, y: 6, z: -4 }, ARCHETYPES.pulser, null, 4)
        if (o) w.acct.external += o.energy
      }
    },
    check(w, st) {
      const alive = w.organisms.length
      const t = w.tick - st.startedTick
      if (alive < 5) return { progress: 0, failed: `Only ${alive} survived. The dark was holding what they needed.` }
      const p = Math.min(1, t / (90 * S))
      return { progress: p, done: p >= 1, note: `${alive} alive.` }
    }
  },
  {
    id: 'breaking',
    num: 9,
    title: 'The Breaking',
    goal: 'Make a ring that includes at least two greys that did not exist when you began.',
    env: 'cradle',
    tools: ['fracture', 'strand', 'tune', 'hand', 'lens', 'anchor'],
    hints: ['There is no grey here yet.', 'Something sealed, broken open, can scatter new things.', 'Collapse the dark, then join what it releases.'],
    setup(w) {
      const B = mk(w, 'black', 0, 0, 0, { mass: 2.4, freq: 0.3 })
      B.energy = capacity(B) * 0.92
      w.acct.external += capacity(B) * 0.82
      mk(w, 'white', -18, 6, 0, { mass: 1.2, freq: 0.45 })
      st0(w).memo.startNodes = w.nextId
    },
    check(w, st) {
      const since = memo(st, 'startNodes')
      for (const r of w.rings) {
        if (!r.confirmed) continue
        const fresh = r.members.filter((id) => id >= since && nodeOf(w, id)?.kind === 'grey').length
        if (fresh >= 2) return { progress: 1, done: true, note: 'A ring of the new.' }
      }
      const greys = w.nodes.filter((n) => n.kind === 'grey' && n.id >= since).length
      return { progress: greys ? 0.4 : 0, note: greys ? `${greys} new greys. Now join them into a loop.` : 'Nothing new yet.' }
    }
  },
  {
    id: 'balance',
    num: 10,
    title: 'Balance Without Equality',
    goal: 'Feed the great dark from all three small lights for forty seconds without it ever overflowing or running dry.',
    env: 'well',
    tools: ['strand', 'tune', 'hand', 'fracture', 'lens', 'anchor'],
    hints: ['A balance does not need equal parts.', 'The dark needs somewhere to put what it takes.', 'Its crystal can store the excess. Keep the inflow gentle: low coupling, more resistance.'],
    setup(w) {
      const B = mk(w, 'black', 0, 0, 0, { mass: 3, freq: 0.3 })
      B.energy = capacity(B) * 0.5
      w.acct.external += capacity(B) * 0.4
      B.anchor = ANCHOR_POS
      const c = nucleate(w, envOf(w.env), B.p, B, 'cubic')!
      growInstant(w, c, 24)
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3
        const s = mk(w, 'white', Math.cos(a) * 16, 4, Math.sin(a) * 16, { mass: 0.6, freq: 0.4 })
        s.anchor = ANCHOR_POS
        st0(w).memo[`w${i}`] = s.id
      }
      st0(w).memo.b = B.id
    },
    check(w, st) {
      const B = nodeOf(w, memo(st, 'b'))
      if (!B) return { progress: 0, failed: 'The great dark is gone.' }
      const f = fill(B)
      let fed = 0
      for (let i = 0; i < 3; i++) {
        const id = memo(st, `w${i}`)
        if (w.strands.some((s) => ((s.a === id && s.b === B.id) || (s.a === B.id && s.b === id)) && Math.abs(s.mean) > 0.03)) fed++
      }
      if (B.well) return { progress: 0, failed: 'It overflowed and collapsed.' }
      const ok = fed === 3 && f > 0.25 && f < 0.95
      const p = hold(st, ok, 40 * S)
      return { progress: p, done: p >= 1, note: `${fed} of 3 lights feeding it; it is ${Math.round(f * 100)}% full.` }
    }
  },
  {
    id: 'long-echo',
    num: 11,
    title: 'The Long Echo',
    goal: 'Make this chamber keep ringing by itself for forty seconds, with nobody touching it.',
    env: 'cradle',
    tools: ['strand', 'tune', 'hand', 'pulse', 'lens', 'anchor'],
    hints: ['A single pulse fades here within seconds.', 'Something has to keep making vibration.', 'Mediators beat when they are fed. Feed them.'],
    setup(w) {
      mk(w, 'white', 0, 10, 0, { mass: 1.6, freq: 0.5 })
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3
        mk(w, 'grey', Math.cos(a) * 12, -2, Math.sin(a) * 12, { mass: 1, freq: 0.5, energy: 1 })
      }
      mk(w, 'black', 0, -14, 0, { mass: 1.2 })
    },
    check(w, st) {
      const U = w.field.signal
      let e2 = 0
      for (let i = 0; i < U.length; i++) e2 += U[i] * U[i]
      const untouched = w.tick - w.lastAction
      const ringing = e2 >= 1.5
      st.held = ringing ? st.held + 1 : 0
      const p = Math.min(1, Math.min(st.held, untouched) / (40 * S))
      return { progress: p, done: p >= 1, note: ringing ? (untouched < 40 * S ? 'It is ringing. Now leave it.' : 'Ringing on its own.') : 'Quiet.' }
    }
  },
  {
    id: 'crossing',
    num: 12,
    title: 'Threshold Crossing',
    goal: 'Carry the ring across to the bright side and keep it there, whole, for ten seconds.',
    env: 'threshold',
    tools: ['hand', 'pull', 'strand', 'tune', 'anchor', 'lens'],
    hints: ['Dragging one member pulls the others along through the strands.', 'Move too fast and the strands snap.', 'Pull the whole ring with the Pull tool, or drag it slowly.'],
    setup(w) {
      const ids: number[] = []
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3
        const n = mk(w, i === 1 ? 'white' : 'grey', -40 + Math.cos(a) * 7, Math.sin(a) * 7, 0, { mass: 1, freq: 0.45, phase: 0 })
        ids.push(n.id)
      }
      for (let i = 0; i < 3; i++) {
        const s = addStrand(w, ids[i], ids[(i + 1) % 3], { coupling: 0.8, origin: 'preset', strength: 1.4 })!
        s.lock = 120
        s.drift = 0
      }
    },
    check(w, st) {
      const first = memo(st, 'ring')
      if (!first) {
        const r = w.rings.find((x) => x.confirmed)
        if (r) memo(st, 'ring', r.id)
        return { progress: 0, note: 'Waiting for the ring to settle.' }
      }
      const r = w.rings.find((x) => x.id === first)
      if (!r) {
        if (w.ghosts.some((g) => g.ring.id === first)) return { progress: 0, note: 'The ring is open. Let it close again.' }
        return { progress: 0, failed: 'The ring broke apart on the way.' }
      }
      const plane = thresholdPlane(envOf(w.env), w.envClock)
      const ok = r.confirmed && r.center.x > plane + 5
      const p = hold(st, ok, 10 * S)
      return { progress: p, done: p >= 1, note: ok ? 'On the bright side.' : `It is ${Math.max(0, plane + 5 - r.center.x).toFixed(0)} units short of the bright side.` }
    }
  }
]

export const CHAMBER_BY_ID = new Map(CHAMBERS.map((c) => [c.id, c]))

function st0(w: WorldState): ChamberState {
  return w.chamber!
}

export function createChamberWorld(id: string, seed: string | number = 'chamber'): WorldState {
  const def = CHAMBER_BY_ID.get(id)
  if (!def) throw new Error(`Unknown chamber ${id}`)
  const w = createWorld({ seed: `${seed}-${id}`, env: def.env, mode: 'chamber' })
  w.chamber = { id, progress: 0, held: 0, done: false, failed: null, memo: {}, startedTick: 0, note: '' }
  def.setup(w)
  return w
}

/** Runs inside step(): drives the chamber and checks its goal. */
export function chamberStep(w: WorldState): void {
  const st = w.chamber
  if (!st || st.done) return
  const def = CHAMBER_BY_ID.get(st.id)
  if (!def) return
  def.drive?.(w, st)
  if (st.failed) return
  const r = def.check(w, st)
  st.progress = Math.max(0, Math.min(1, r.progress))
  st.note = r.note ?? ''
  if (r.failed) st.failed = r.failed
  if (r.done) {
    st.done = true
    st.progress = 1
  }
}
