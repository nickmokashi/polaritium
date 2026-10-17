import { BIRTH_LOCK_TICKS, BLACK_COLLAPSE_TICKS, STRAND_MAX_CURRENT_PER_STRENGTH, TICKS_PER_SECOND } from './constants'
import { envOf } from './environments'
import { sample, vibration } from './field'
import { GENE_NAMES, bodyRadius, maxEnergy, maxSpeed, senseRadius, STATES } from './organisms'
import { ringOf } from './structures'
import type { Vec3 } from './math'
import type { WorldState } from './types'
import { capacity, fill, potential } from './world'

// Plain-language readings of anything the player selects. First what it is doing, then the
// numbers behind it. Every sentence is computed from the state; nothing is invented.

export interface Reading {
  id: number
  type: 'node' | 'strand' | 'organism' | 'crystal' | 'ring' | 'veil' | 'field'
  title: string
  name: string | null
  /** One or two sentences: what it is doing right now and why. */
  doing: string[]
  /** Measured values, label → value (already formatted). */
  values: [string, string][]
  /** Extra detail shown under "More". */
  more: [string, string][]
  /** Bars, 0..1, for quick reading (utilities, fill, stress). */
  bars: [string, number][]
  links: { id: number; label: string }[]
  /** Facts for the AI layer (small, structured). */
  facts: Record<string, number | string>
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const n2 = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2))
const KIND_NAME = { black: 'Dark (absorbing)', white: 'Light (emitting)', grey: 'Grey (mediating)' }

export function inspect(w: WorldState, id: number): Reading | null {
  const env = envOf(w.env)
  const node = w.nodes.find((n) => n.id === id)
  if (node) {
    const f = fill(node)
    const strands = w.strands.filter((s) => s.a === id || s.b === id)
    let inflow = 0
    for (const s of strands) inflow += s.a === id ? -s.mean : s.mean
    const doing: string[] = []
    if (node.kind === 'white') {
      doing.push(`Emitting light into the space around it. It is ${pct(f)} full.`)
      if (node.sat > 60) doing.push('It cannot give its energy away fast enough. If this goes on it will break apart.')
    } else if (node.kind === 'black') {
      doing.push(`Drinking in light and energy. It is ${pct(f)} full${node.well ? ', a well since it collapsed' : ''}.`)
      if (node.sat > 0) doing.push(`It is saturated. ${Math.max(0, Math.ceil((BLACK_COLLAPSE_TICKS - node.sat) / TICKS_PER_SECOND))} more seconds like this and it collapses.`)
    } else {
      doing.push(f >= 0.35 ? 'Gathering energy and releasing it in beats, passing it on and sending out a pulse.' : 'Gathering energy. It beats once it holds a little more than a third of what it can.')
      if (node.starve > 300) doing.push('It has been nearly empty for a long while and is starting to fade.')
    }
    if (strands.length) doing.push(`${strands.length} strand${strands.length > 1 ? 's' : ''}; net flow ${inflow >= 0 ? 'in' : 'out'} ${n2(Math.abs(inflow))} a second.`)
    const ring = ringOf(w, id)
    const crystal = w.crystals.find((c) => c.anchor === id)
    const links: Reading['links'] = strands.map((s) => ({ id: s.id, label: `Strand to #${s.a === id ? s.b : s.a}` }))
    if (ring) links.push({ id: ring.id, label: `Ring of ${ring.members.length}` })
    if (crystal) links.push({ id: crystal.id, label: `Crystal (${crystal.segs.length} facets)` })
    return {
      id,
      type: 'node',
      title: KIND_NAME[node.kind],
      name: node.name,
      doing,
      values: [
        ['Energy', `${n2(node.energy)} of ${n2(capacity(node))}`],
        ['Rhythm', `${node.freq.toFixed(2)} beats a second`],
        ['Mass', n2(node.mass)],
        ['Speed', n2(Math.hypot(node.v.x, node.v.y, node.v.z))]
      ],
      more: [
        ['Potential', n2(potential(node))],
        ['Phase', `${Math.round((node.phase / (Math.PI * 2)) * 360)}°`],
        ['Force felt', n2(Math.hypot(node.force.x, node.force.y, node.force.z))],
        ['Light here', n2(sample(w.field.radiance, w.field, node.p))],
        ['Vibration here', n2(vibration(w.field, node.p))],
        ['Anchored', node.anchor ? [node.anchor & 1 ? 'place' : '', node.anchor & 2 ? 'rhythm' : '', node.anchor & 4 ? 'energy' : ''].filter(Boolean).join(', ') : 'no'],
        ['Age', `${(node.age / TICKS_PER_SECOND).toFixed(0)} s`]
      ],
      bars: [
        ['Full', f],
        [node.kind === 'black' ? 'Toward collapse' : node.kind === 'white' ? 'Overload' : 'Fading', node.kind === 'black' ? node.sat / BLACK_COLLAPSE_TICKS : node.kind === 'white' ? node.sat / 240 : node.starve / 900]
      ],
      links,
      facts: { kind: node.kind, fill: +f.toFixed(3), freq: +node.freq.toFixed(3), mass: +node.mass.toFixed(2), strands: strands.length, netInflow: +inflow.toFixed(3), well: node.well ? 1 : 0 }
    }
  }
  const s = w.strands.find((x) => x.id === id)
  if (s) {
    const A = w.nodes.find((n) => n.id === s.a)
    const B = w.nodes.find((n) => n.id === s.b)
    const strength = s.strength * env.strandStrength
    const iMax = STRAND_MAX_CURRENT_PER_STRENGTH * strength
    const doing: string[] = []
    const from = s.mean >= 0 ? A : B
    const to = s.mean >= 0 ? B : A
    if (Math.abs(s.mean) > 0.05 && from && to) doing.push(`Carrying ${n2(Math.abs(s.mean))} energy a second from the ${from.kind === 'white' ? 'light' : from.kind === 'black' ? 'dark' : 'grey'} to the ${to.kind === 'white' ? 'light' : to.kind === 'black' ? 'dark' : 'grey'}.`)
    else doing.push('Barely carrying anything right now.')
    if (s.lock > 60) doing.push(`Its ends are in step (resonant) for ${(s.lock / TICKS_PER_SECOND).toFixed(0)} seconds.`)
    else if (w.laws.phase) doing.push('Its ends are out of step, so flow rises and falls as they drift.')
    if (s.amp > 0.4) doing.push(`The flow is swinging back and forth about ${s.oscFreq.toFixed(2)} times a second.`)
    if (s.stress > 0.3) doing.push(`Under strain: ${pct(s.stress)} of the way to breaking.`)
    if (!s.birthDone && A && B && ((A.kind === 'white' && B.kind === 'black') || (A.kind === 'black' && B.kind === 'white')) && s.lock > 90)
      doing.push(`Something is forming at its middle (${pct(Math.min(1, s.lock / BIRTH_LOCK_TICKS))}).`)
    return {
      id,
      type: 'strand',
      title: 'Strand',
      name: null,
      doing,
      values: [
        ['Flow', `${n2(s.current)} a second`],
        ['Coupling', n2(s.coupling)],
        ['Resistance', n2(s.resistance)],
        ['Tension', n2(s.tension)],
        ['Twist', `${Math.round((s.twist / (Math.PI * 2)) * 360)}°`]
      ],
      more: [
        ['Rest length', n2(s.rest)],
        ['Stiffness', n2(s.elasticity)],
        ['Direction bias', n2(s.bias)],
        ['Swing', n2(s.amp)],
        ['Swing frequency', `${s.oscFreq.toFixed(2)} Hz`],
        ['In step for', `${(s.lock / TICKS_PER_SECOND).toFixed(1)} s`],
        ['Strength', n2(strength)],
        ['Formed by', s.origin === 'spontaneous' ? 'itself' : s.origin === 'player' ? 'you' : s.origin],
        ['Anchored', s.anchored ? 'yes' : 'no']
      ],
      bars: [
        ['Load', Math.min(1, Math.abs(s.current) / iMax)],
        ['Tension', Math.min(1, Math.abs(s.tension) / (12 * strength))],
        ['Strain', Math.min(1, s.stress)],
        ['In step', Math.min(1, s.lock / 90)]
      ],
      links: [A, B].filter(Boolean).map((n) => ({ id: n!.id, label: KIND_NAME[n!.kind] })),
      facts: { flow: +s.current.toFixed(3), coupling: +s.coupling.toFixed(3), resistance: +s.resistance.toFixed(3), twist: +s.twist.toFixed(3), lockSeconds: +(s.lock / TICKS_PER_SECOND).toFixed(1), swing: +s.amp.toFixed(3), stress: +s.stress.toFixed(3) }
    }
  }
  const o = w.organisms.find((x) => x.id === id)
  if (o) {
    const g = o.genome
    const maxE = maxEnergy(g)
    const STATE_TEXT: Record<string, string> = {
      explore: 'Exploring: nothing nearby is strong enough to pull it one way.',
      feed: g[3] < 0.5 ? 'Feeding: moving up the gradient of light.' : 'Feeding: moving toward vibration, which it eats.',
      flee: 'Fleeing: the disturbance or glare here is more than it can take.',
      rest: 'Resting: low on energy with no food in reach.',
      dormant: 'Dormant: almost shut down, waiting for food to come near.',
      divide: 'Dividing.',
      bond: 'Seeking its kin to bond with.',
      follow: 'Following a strand to feed on the energy flowing along it.'
    }
    const responding = [...Object.entries(o.sensed)].sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    return {
      id,
      type: 'organism',
      title: { membrane: 'Membrane form', motile: 'Motile form', oscillating: 'Oscillating form', adaptive: 'Adaptive form' }[o.family],
      name: o.name,
      doing: [STATE_TEXT[o.state] ?? o.state, `Most aware of: ${responding ? responding[0] : 'nothing'}. Generation ${o.generation}.`],
      values: [
        ['Energy', `${n2(o.energy)} of ${n2(maxE)}`],
        ['State', o.state],
        ['Age', `${(o.age / TICKS_PER_SECOND).toFixed(0)} s`],
        ['Generation', String(o.generation)],
        ['Learned wariness', pct(o.sens)]
      ],
      more: [
        ...GENE_NAMES.map((name, i) => [`Gene: ${name}`, g[i].toFixed(2)] as [string, string]),
        ['Body size', n2(bodyRadius(g))],
        ['Top speed', n2(maxSpeed(g))],
        ['Senses to', n2(senseRadius(g))],
        ['Line of descent', `#${o.lineage}`],
        ['Senses light', n2(o.sensed.light)],
        ['Senses vibration', n2(o.sensed.vibration)],
        ['Danger felt', n2(o.sensed.danger)],
        ['Kin nearby', String(o.sensed.kin)]
      ],
      bars: STATES.map((st, i) => [`Wants to ${st}`, Math.min(1, (o.util[i] ?? 0) / 1.5)] as [string, number]).filter((b) => b[1] > 0.01),
      links: w.bonds.filter((b) => b.a === id || b.b === id).map((b) => ({ id: b.a === id ? b.b : b.a, label: 'Bonded kin' })),
      facts: { family: o.family, state: o.state, energyFrac: +(o.energy / maxE).toFixed(3), generation: o.generation, diet: +g[3].toFixed(2), caution: +g[5].toFixed(2), sociality: +g[6].toFixed(2), wariness: +o.sens.toFixed(2), light: +o.sensed.light.toFixed(2), vibration: +o.sensed.vibration.toFixed(2) }
    }
  }
  const c = w.crystals.find((x) => x.id === id)
  if (c) {
    const maxStress = c.segs.reduce((m, s) => Math.max(m, s.stress), 0)
    const growing = c.segs.filter((s) => s.growing).length
    return {
      id,
      type: 'crystal',
      title: `Crystal (${c.habit})`,
      name: c.name,
      doing: [
        growing ? `Growing at ${growing} tips toward the light, drinking radiance as it goes.` : 'Not growing: too little light here, or too much vibration.',
        c.resonance > 0.02 ? `It is being shaken at its own frequency (${c.freq.toFixed(2)} Hz). That is what breaks crystals.` : `Its own frequency is ${c.freq.toFixed(2)} Hz. Shaking at that rhythm would break it.`
      ],
      values: [
        ['Facets', String(c.segs.length)],
        ['Stored energy', n2(c.energy)],
        ['Own frequency', `${c.freq.toFixed(2)} Hz`],
        ['Resonance', n2(c.resonance)]
      ],
      more: [
        ['Most strained facet', pct(maxStress)],
        ['Largest it has been', String(c.peak)],
        ['Age', `${(c.age / TICKS_PER_SECOND).toFixed(0)} s`],
        ['Grows on', c.anchor >= 0 ? `#${c.anchor}` : 'nothing (free)']
      ],
      bars: [
        ['Strain', maxStress],
        ['Resonance', Math.min(1, c.resonance * 10)]
      ],
      links: c.anchor >= 0 ? [{ id: c.anchor, label: 'Dark it grows on' }] : [],
      facts: { facets: c.segs.length, freq: +c.freq.toFixed(3), resonance: +c.resonance.toFixed(3), energy: +c.energy.toFixed(2), maxStrain: +maxStress.toFixed(2) }
    }
  }
  const r = w.rings.find((x) => x.id === id)
  if (r) {
    return {
      id,
      type: 'ring',
      title: r.membrane ? 'Membrane' : 'Resonant ring',
      name: r.name,
      doing: [
        `A closed loop of ${r.members.length}, ${pct(r.coherence)} in step.`,
        r.winding !== 0 ? 'Its rhythm runs around the loop and never settles: it turns.' : 'Its rhythm is settled around the loop.',
        r.membrane ? `It has closed a boundary holding ${n2(r.membrane.energy)} energy${r.membrane.quickenings ? `; life has quickened in it ${r.membrane.quickenings} time${r.membrane.quickenings > 1 ? 's' : ''}` : ''}.` : 'With enough energy and coherence it can close into a membrane.'
      ],
      values: [
        ['Members', String(r.members.length)],
        ['In step', pct(r.coherence)],
        ['Winding', String(r.winding)],
        ['Energy held by members', n2(r.energy)]
      ],
      more: [
        ['Circulating flow', n2(r.circulation)],
        ['Average rhythm', `${r.freq.toFixed(2)} Hz`],
        ['Radius', n2(r.radius)],
        ['Age', `${(r.age / TICKS_PER_SECOND).toFixed(0)} s`],
        ['Sizes it has had', r.sizes.join(' → ')]
      ],
      bars: [
        ['In step', r.coherence],
        ['Membrane energy', r.membrane ? Math.min(1, r.membrane.energy / 140) : 0]
      ],
      links: r.members.map((m) => ({ id: m, label: `Member #${m}` })),
      facts: { members: r.members.length, coherence: +r.coherence.toFixed(3), winding: r.winding, energy: +r.energy.toFixed(1), membrane: r.membrane ? +r.membrane.energy.toFixed(1) : 0 }
    }
  }
  const v = w.veils.find((x) => x.id === id)
  if (v) {
    const blocks = [v.mask & 1 ? 'light' : '', v.mask & 2 ? 'vibration' : '', v.mask & 4 ? 'forces' : '', v.mask & 8 ? 'strand flow' : '', v.mask & 16 ? 'living forms' : ''].filter(Boolean).join(', ')
    return {
      id,
      type: 'veil',
      title: 'Veil',
      name: null,
      doing: [`Isolating this region from outside ${blocks}.`, `It lifts in ${(v.ticks / TICKS_PER_SECOND).toFixed(0)} seconds.`],
      values: [['Radius', n2(v.r)]],
      more: [],
      bars: [],
      links: [],
      facts: { radius: v.r, seconds: Math.round(v.ticks / TICKS_PER_SECOND) }
    }
  }
  return null
}

export function inspectPoint(w: WorldState, p: Vec3): Reading {
  const light = sample(w.field.radiance, w.field, p)
  const vib = vibration(w.field, p)
  return {
    id: 0,
    type: 'field',
    title: 'The medium here',
    name: null,
    doing: [light > 1 ? 'Bright with radiance.' : light > 0.2 ? 'Faintly lit.' : 'Dark.', vib > 1 ? 'Strongly vibrating.' : vib > 0.2 ? 'Trembling slightly.' : 'Still.'],
    values: [
      ['Light', n2(light)],
      ['Vibration', n2(vib)]
    ],
    more: [],
    bars: [],
    links: [],
    facts: { light: +light.toFixed(3), vibration: +vib.toFixed(3) }
  }
}

/** A compact, structured summary of the whole experiment (for local and AI interpretation). */
export function summarize(w: WorldState): Record<string, number | string> {
  const env = envOf(w.env)
  let flow = 0
  let locked = 0
  for (const s of w.strands) {
    flow += Math.abs(s.mean)
    if (s.lock > 60) locked++
  }
  const kinds = { black: 0, white: 0, grey: 0 }
  for (const n of w.nodes) kinds[n.kind]++
  return {
    environment: env.name,
    seconds: Math.round(w.tick / TICKS_PER_SECOND),
    light: kinds.white,
    dark: kinds.black,
    grey: kinds.grey,
    strands: w.strands.length,
    lockedStrands: locked,
    totalFlow: +flow.toFixed(2),
    rings: w.rings.filter((r) => r.confirmed).length,
    membranes: w.rings.filter((r) => r.membrane).length,
    crystals: w.crystals.length,
    crystalFacets: w.crystals.reduce((s, c) => s + c.segs.length, 0),
    organisms: w.organisms.length,
    generations: w.stats.maxGeneration,
    births: w.stats.births,
    collapses: w.stats.collapses,
    fractures: w.stats.fractures,
    quickenings: w.stats.quickenings,
    divisions: w.stats.divisions,
    deaths: w.stats.deaths
  }
}
