import { STRUCTURE_INTERVAL, TICKS_PER_SECOND } from './constants'
import { envOf } from './environments'
import { TAU } from './math'
import { GENE_NAMES } from './organisms'
import type { Kind, Laws, SimEvent, WorldState } from './types'
import { emit } from './world'

// The local classification engine. Every few ticks it measures the universe against defined
// thresholds. A finding is reported once per universe per kind; the Atlas then decides what is
// new for the player. Nothing is reported that the state does not show.

export interface DiscoveryType {
  id: string
  name: string
  /** One plain line for the Atlas. */
  line: string
  /** How to make it happen again. */
  reproduce: string
  /** Which law wakes in Genesis when this is first found. */
  wakes?: keyof Laws
}

export const DISCOVERIES: DiscoveryType[] = [
  { id: 'current', name: 'Living Current', line: 'Energy kept flowing along a strand for seconds on end.', reproduce: 'Connect a light to a dark with a strand and wait.', wakes: 'phase' },
  { id: 'resonance', name: 'First Resonance', line: 'Two ends of a strand fell into step and held it.', reproduce: 'Bring two natural frequencies close with Tune, or raise the coupling, until the strand locks.', wakes: 'mediators' },
  { id: 'third', name: 'The Third Thing', line: 'A resonant strand between light and dark gave birth to something neither was: a grey mediator.', reproduce: 'Keep a light-dark strand locked in resonance while energy flows for about fifteen seconds.', wakes: 'crystals' },
  { id: 'collapse', name: 'Collapse', line: 'A dark concentration took in more than it could hold and collapsed into a well, scattering what it had kept.', reproduce: 'Let a dark node fill to saturation and stay there.' },
  { id: 'shatter', name: 'Overflowing Light', line: 'A light that could not give its energy away broke into pieces.', reproduce: 'Trap a light where its radiance cannot spread, such as inside a Veil, until it overflows.' },
  { id: 'oscillation', name: 'Self-Sustaining Oscillation', line: 'A flow kept swinging back and forth with nobody touching it.', reproduce: 'Strong coupling and low resistance let a strand ring; mediators firing can keep it going.' },
  { id: 'ring', name: 'Resonant Ring', line: 'A closed loop of locked strands held together as one structure.', reproduce: 'Connect three or more nodes in a loop and bring them into step.', wakes: 'membranes' },
  { id: 'wheel', name: 'Turning Wheel', line: 'A ring whose rhythm runs around it, never settling: a frustrated loop that turns.', reproduce: 'Twist the strands of a ring so their offsets add up to a full turn.' },
  { id: 'crystal', name: 'Persistent Crystal', line: 'A crystal grew past twenty facets and lasted a full minute.', reproduce: 'Keep a dark node fed in a still place, away from strong vibration.' },
  { id: 'membrane', name: 'First Membrane', line: 'A coherent, energised ring closed a boundary around energy.', reproduce: 'Hold a ring in step with plenty of energy among its members for a while.', wakes: 'life' },
  { id: 'quickening', name: 'Quickening', line: 'Something began to move by itself inside a membrane.', reproduce: 'Fill a membrane with energy where the radiance is uneven across it.' },
  { id: 'motile', name: 'First Mobile Organism', line: 'A form travelled under its own power, steering by what it sensed.', reproduce: 'Life that quickens with a strong light side tends to swim.' },
  { id: 'lineage', name: 'Repeated Reproduction', line: 'Life divided, and its offspring divided, three generations deep.', reproduce: 'Give organisms enough to eat and room to grow.', wakes: 'adaptation' },
  { id: 'colony', name: 'Colony', line: 'Three or more related organisms bonded and held together.', reproduce: 'Sociable kin that stay near each other bond.' },
  { id: 'chorus', name: 'Chorus', line: 'Five or more rhythms fell into step together.', reproduce: 'Connect mediators, or let oscillating forms gather; flashes pull neighbours into time.' },
  { id: 'chain', name: 'Chain Reaction', line: 'One break triggered another, and another.', reproduce: 'Stress a crowded, brittle network and fracture one strand.' },
  { id: 'survivor', name: 'Survivor', line: 'A structure came through a major disturbance intact.', reproduce: 'Pulse hard near a ring that is strongly coupled, or protect it with a Veil.' },
  { id: 'network', name: 'Stable Network', line: 'Several structures joined into one lasting network.', reproduce: 'Link two rings, or grow a crystal on a ring member.' },
  { id: 'adaptation', name: 'Adaptation', line: 'A population’s inherited traits shifted under pressure across generations.', reproduce: 'Keep a population under the same pressure, such as repeated pulses, for several generations.' },
  { id: 'orbit', name: 'Orbit', line: 'A body kept circling a dark concentration, held by pull and pushed by light.', reproduce: 'Throw a node sideways past a dark one with the Hand.' },
  { id: 'echo', name: 'Long Echo', line: 'A vibration lingered for forty seconds after the last disturbance.', reproduce: 'Pulse once in the Stillness Well or the Cathedral and wait.' },
  { id: 'waking', name: 'Waking', line: 'A dormant organism sensed food and woke.', reproduce: 'Bring light or vibration near a sleeping form.' },
  { id: 'parasite', name: 'Siphon', line: 'An organism fed on the energy flowing along a strand.', reproduce: 'Forms that follow strands feed on busy connections.' },
  { id: 'crossing', name: 'Crossing Over', line: 'Something that lingered on the far side of the Threshold changed its expression.', reproduce: 'Hold a dark node in the bright half of the Threshold.' },
  { id: 'regrowth', name: 'Regrowth', line: 'What broke grew back.', reproduce: 'In the Fracture Garden, keep broken ends close, or let shards settle somewhere still.' },
  { id: 'speciation', name: 'Divergence', line: 'A line of descent drifted far enough to become a new kind.', reproduce: 'Let a varied population reproduce for many generations.' },
  { id: 'stillness', name: 'Deep Stillness', line: 'A structure held for two full minutes.', reproduce: 'Build a ring somewhere calm and leave it be.' },
  { id: 'form', name: 'New Form', line: 'A structure with a shape not seen before persisted.', reproduce: 'Rings differ by size, mixture of expressions and how their rhythm winds.' }
]

export const DISCOVERY_BY_ID = new Map(DISCOVERIES.map((d) => [d.id, d]))

export const LAW_TEXT: Record<keyof Laws, string> = {
  phase: 'The medium learns rhythm. Strands now carry phase, and things can fall into step.',
  mediators: 'The medium learns to mediate. Resonance can now give birth to grey.',
  crystals: 'The medium learns to hold its shape. Crystals can now grow.',
  membranes: 'The medium learns to enclose. Rings can now close around energy.',
  life: 'The medium learns to move by itself. Membranes can now quicken.',
  adaptation: 'The medium learns to change. Offspring now differ from their parents.'
}

function report(w: WorldState, id: string, subject: number, value: number, p: { x: number; y: number; z: number } | null, extra = ''): void {
  if (w.found[id] !== undefined) return
  w.found[id] = w.tick
  emit(w, 'finding', p, { text: extra ? `${id}|${extra}` : id, a: subject, value })
  const d = DISCOVERY_BY_ID.get(id)
  if (d?.wakes && !w.laws[d.wakes] && w.mode === 'genesis') {
    w.laws[d.wakes] = true
    emit(w, 'law', p, { text: d.wakes })
  }
}

const kindCode: Record<Kind, string> = { black: 'B', white: 'W', grey: 'G' }

export function ringSignature(w: WorldState, members: number[], winding: number): string {
  const kinds = members
    .map((id) => w.nodes.find((n) => n.id === id))
    .filter(Boolean)
    .map((n) => kindCode[n!.kind])
    .sort()
    .join('')
  return `ring${members.length}-${kinds}-w${Math.abs(winding)}`
}

function recentEvents(w: WorldState, types: string[], since: number): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = w.log.length - 1; i >= 0; i--) {
    const e = w.log[i]
    if (e.t <= since) break
    if (types.includes(e.type)) out.push(e)
  }
  return out
}

export function discoveryStep(w: WorldState): void {
  if (w.tick % STRUCTURE_INTERVAL !== 0) return
  const since = w.tick - STRUCTURE_INTERVAL
  const env = envOf(w.env)

  // Event-based findings: they happened, so they are reported.
  const eventMap: [string, string][] = [
    ['birth', 'third'],
    ['collapse', 'collapse'],
    ['shatter', 'shatter'],
    ['membrane', 'membrane'],
    ['quickening', 'quickening'],
    ['woke', 'waking'],
    ['transform', 'crossing'],
    ['regrowth', 'regrowth'],
    ['speciation', 'speciation']
  ]
  for (const e of recentEvents(
    w,
    eventMap.map((x) => x[0]),
    since
  )) {
    const id = eventMap.find((x) => x[0] === e.type)![1]
    report(w, id, e.a ?? 0, e.value ?? 0, e)
  }

  for (const s of w.strands) {
    if (w.found.current === undefined && Math.abs(s.mean) >= 0.6 && w.tick - s.born >= 5 * TICKS_PER_SECOND) report(w, 'current', s.id, Math.abs(s.mean), null)
    if (w.found.resonance === undefined && s.lock >= 10 * TICKS_PER_SECOND) report(w, 'resonance', s.id, s.lock, null)
    if (w.found.oscillation === undefined && s.amp >= 0.5 && s.oscFreq >= 0.05 && w.tick - w.lastAction >= 20 * TICKS_PER_SECOND) report(w, 'oscillation', s.id, s.amp, null)
  }

  for (const r of w.rings) {
    if (!r.confirmed) continue
    if (r.age >= 20 * TICKS_PER_SECOND) report(w, 'ring', r.id, r.members.length, r.center)
    if (r.winding !== 0 && r.age >= 10 * TICKS_PER_SECOND) report(w, 'wheel', r.id, r.winding, r.center)
    if (r.age >= 120 * TICKS_PER_SECOND) report(w, 'stillness', r.id, r.age, r.center)
    if (r.age >= 20 * TICKS_PER_SECOND) {
      const sig = ringSignature(w, r.members, r.winding)
      const key = `form:${sig}`
      if (w.found[key] === undefined) {
        w.found[key] = w.tick
        emit(w, 'finding', r.center, { text: `form|${sig}`, a: r.id, value: r.members.length })
      }
    }
  }

  for (const c of w.crystals) {
    if (c.segs.length >= 20 && c.age >= 60 * TICKS_PER_SECOND) report(w, 'crystal', c.id, c.segs.length, c.origin)
  }

  for (const o of w.organisms) {
    const sp = Math.sqrt(o.v.x * o.v.x + o.v.y * o.v.y + o.v.z * o.v.z)
    if ((o.family === 'motile' || o.family === 'adaptive') && o.age >= 300 && sp > 0.8) report(w, 'motile', o.id, sp, o.p)
    if (o.generation >= 3) report(w, 'lineage', o.id, o.generation, o.p)
    if (o.siphon > 0.5) report(w, 'parasite', o.id, o.siphon, o.p)
  }

  // Colony: a connected group of three or more bonded organisms, bonds older than ten seconds.
  if (w.found.colony === undefined && w.bonds.length >= 2) {
    const adj = new Map<number, number[]>()
    for (const b of w.bonds) {
      if (b.age < 300) continue
      if (!adj.has(b.a)) adj.set(b.a, [])
      if (!adj.has(b.b)) adj.set(b.b, [])
      adj.get(b.a)!.push(b.b)
      adj.get(b.b)!.push(b.a)
    }
    const seen = new Set<number>()
    for (const start of [...adj.keys()].sort((a, b) => a - b)) {
      if (seen.has(start)) continue
      const comp: number[] = []
      const q = [start]
      seen.add(start)
      while (q.length) {
        const u = q.shift()!
        comp.push(u)
        for (const v of adj.get(u)!) if (!seen.has(v)) (seen.add(v), q.push(v))
      }
      if (comp.length >= 3) {
        const o = w.organisms.find((x) => x.id === comp[0])
        report(w, 'colony', comp[0], comp.length, o?.p ?? null)
        break
      }
    }
  }

  // Chorus: five or more rhythms in step.
  if (w.found.chorus === undefined) {
    const osc = w.organisms.filter((o) => o.family === 'oscillating')
    if (osc.length >= 5) {
      let sx = 0
      let sy = 0
      for (const o of osc) {
        sx += Math.cos(o.phase)
        sy += Math.sin(o.phase)
      }
      const r = Math.sqrt(sx * sx + sy * sy) / osc.length
      w.memo.chorusOrg = r >= 0.9 ? (w.memo.chorusOrg ?? 0) + 1 : 0
      if (w.memo.chorusOrg >= 30) report(w, 'chorus', osc[0].id, r, osc[0].p)
    }
    const greys = w.nodes.filter((n) => n.kind === 'grey')
    if (greys.length >= 5) {
      let sx = 0
      let sy = 0
      for (const g of greys) {
        sx += Math.cos(g.phase)
        sy += Math.sin(g.phase)
      }
      const r = Math.sqrt(sx * sx + sy * sy) / greys.length
      w.memo.chorusGrey = r >= 0.9 ? (w.memo.chorusGrey ?? 0) + 1 : 0
      if (w.memo.chorusGrey >= 30) report(w, 'chorus', greys[0].id, r, greys[0].p)
    }
  }

  // Chain reaction: three breaks within three seconds, each near an earlier one.
  if (w.found.chain === undefined) {
    const breaks = recentEvents(w, ['fracture', 'collapse', 'shatter', 'crystalBreak', 'membraneBurst'], w.tick - 3 * TICKS_PER_SECOND).reverse()
    if (breaks.length >= 3) {
      const linked = [breaks[0]]
      for (let i = 1; i < breaks.length; i++) {
        const e = breaks[i]
        if (linked.some((l) => (l.x - e.x) ** 2 + (l.y - e.y) ** 2 + (l.z - e.z) ** 2 < 25 * 25)) linked.push(e)
      }
      if (linked.length >= 3) report(w, 'chain', 0, linked.length, linked[linked.length - 1])
    }
  }

  // Survivor: a ring that existed before a strong disturbance nearby and is still here.
  if (w.found.survivor === undefined) {
    for (const e of w.log) {
      if ((e.type !== 'pulse' && e.type !== 'quake') || (e.value ?? 0) < 5) continue
      const age = w.tick - e.t
      if (age < 150 || age > 600) continue
      for (const r of w.rings) {
        if (!r.confirmed || r.born > e.t - 30) continue
        const d2 = (r.center.x - e.x) ** 2 + (r.center.y - e.y) ** 2 + (r.center.z - e.z) ** 2
        if (d2 < 25 * 25) report(w, 'survivor', r.id, e.value ?? 0, r.center)
      }
    }
  }

  // Stable network: one strand-connected component holding two rings, or a ring and a crystal.
  if (w.found.network === undefined) {
    const old = w.rings.filter((r) => r.confirmed && r.age >= 300)
    if (old.length) {
      const comp = components(w)
      for (const r of old) {
        const cid = comp.get(r.members[0])
        const others = old.filter((x) => x !== r && comp.get(x.members[0]) === cid && !x.members.some((m) => r.members.includes(m)))
        const crystal = w.crystals.find((c) => c.segs.length >= 8 && c.anchor >= 0 && comp.get(c.anchor) === cid)
        if (others.length || crystal) {
          report(w, 'network', r.id, 1 + others.length + (crystal ? 1 : 0), r.center)
          break
        }
      }
    }
  }

  // Adaptation: inherited trait means shifting across generations.
  if (w.found.adaptation === undefined && w.traitHistory.length >= 9) {
    const last = w.traitHistory[w.traitHistory.length - 1]
    for (let k = w.traitHistory.length - 9; k >= 0; k--) {
      const prev = w.traitHistory[k]
      if (last.count < 6 || prev.count < 6 || last.maxGen - prev.maxGen < 3) continue
      let best = 0
      let gi = -1
      for (let i = 0; i < last.means.length; i++) {
        const d = Math.abs(last.means[i] - prev.means[i])
        if (d > best) {
          best = d
          gi = i
        }
      }
      if (best >= 0.12) {
        report(w, 'adaptation', 0, best, null, GENE_NAMES[gi])
        break
      }
    }
  }

  // Orbit: steady sideways motion around a dark concentration, held for twenty seconds.
  for (const n of w.nodes) {
    if (n.kind === 'black' || n.held || n.anchor) continue
    let best: (typeof w.nodes)[number] | null = null
    let bd = 30 * 30
    for (const b of w.nodes) {
      if (b.kind !== 'black') continue
      const d2 = (b.p.x - n.p.x) ** 2 + (b.p.y - n.p.y) ** 2 + (b.p.z - n.p.z) ** 2
      if (d2 < bd) {
        bd = d2
        best = b
      }
    }
    const key = `orbit:${n.id}`
    if (!best) {
      delete w.memo[key]
      continue
    }
    const rx = n.p.x - best.p.x
    const ry = n.p.y - best.p.y
    const rz = n.p.z - best.p.z
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1
    const vx = n.v.x - best.v.x
    const vy = n.v.y - best.v.y
    const vz = n.v.z - best.v.z
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz)
    const radial = Math.abs((vx * rx + vy * ry + vz * rz) / rl)
    if (sp >= 1.2 && radial < 0.45 * sp) w.memo[key] = (w.memo[key] ?? 0) + 1
    else delete w.memo[key]
    if ((w.memo[key] ?? 0) >= 40) report(w, 'orbit', n.id, sp, n.p)
  }

  // Long echo: the field still vibrating forty seconds after the last disturbance.
  {
    const lastDisturb = recentEvents(w, ['pulse', 'quake', 'fracture', 'collapse', 'shatter', 'crystalBreak', 'membraneBurst', 'cut'], since)
    let e2 = 0
    const V = w.field.signalVel
    const U = w.field.signal
    for (let i = 0; i < U.length; i++) e2 += U[i] * U[i] + 0.02 * V[i] * V[i]
    if (lastDisturb.length || e2 < 2) w.memo.echo = 0
    else w.memo.echo = (w.memo.echo ?? 0) + 1
    if (w.memo.echo >= (40 * TICKS_PER_SECOND) / STRUCTURE_INTERVAL) report(w, 'echo', 0, e2, null)
  }
  void env
  void TAU
}

function components(w: WorldState): Map<number, number> {
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let y = x
    while (parent.get(y) !== r) {
      const n = parent.get(y)!
      parent.set(y, r)
      y = n
    }
    return r
  }
  for (const n of w.nodes) parent.set(n.id, n.id)
  for (const s of w.strands) {
    if (!parent.has(s.a) || !parent.has(s.b)) continue
    const a = find(s.a)
    const b = find(s.b)
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b))
  }
  const out = new Map<number, number>()
  for (const n of w.nodes) out.set(n.id, find(n.id))
  return out
}
