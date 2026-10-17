import type { Vec3 } from './math'

export type Kind = 'black' | 'white' | 'grey'
export type EnvId = 'cradle' | 'cathedral' | 'garden' | 'well' | 'threshold' | 'genesis'
export type Mode = 'lab' | 'genesis' | 'chamber' | 'gallery'

export interface SimNode {
  id: number
  kind: Kind
  p: Vec3
  v: Vec3
  /** Net force felt last tick (for the Lens). */
  force: Vec3
  mass: number
  energy: number
  freq: number
  phase: number
  stress: number
  age: number
  /** Black: ticks held at saturation. White: ticks held overfull. */
  sat: number
  /** Ticks spent nearly empty. */
  starve: number
  anchor: number
  held: boolean
  /** Hand target while held. */
  target: Vec3 | null
  /** Energy held fixed by the Anchor. */
  anchorEnergy: number
  /** Recent firing or transformation glow, 0..1 (state, so replays match). */
  glow: number
  /** Collapsed absorbers become wells: denser, hungrier. */
  well: boolean
  name: string | null
  born: number
  /** Ticks this node has been in the white zone (+) or black zone (-) of the Threshold. */
  zone: number
}

export type StrandOrigin = 'player' | 'spontaneous' | 'birth' | 'regrowth' | 'fuse' | 'collapse' | 'preset'

export interface SimStrand {
  id: number
  a: number
  b: number
  coupling: number
  rest: number
  elasticity: number
  resistance: number
  /** Phase offset the strand tries to hold between its ends (the Twist). Radians. */
  twist: number
  /** -1..1: positive lets energy flow a→b more easily than b→a. */
  bias: number
  current: number
  tension: number
  stress: number
  strength: number
  lock: number
  prevDelta: number
  /** Smoothed rate at which the phase difference drifts (rad/s). Near zero means locked. */
  drift: number
  mean: number
  vari: number
  amp: number
  /** Measured oscillation frequency of the current (Hz). */
  oscFreq: number
  lastSign: number
  crossings: number
  crossTimer: number
  idle: number
  axis: Vec3
  origin: StrandOrigin
  anchored: boolean
  born: number
  birthDone: boolean
  /** Energy carried this tick, for visuals. */
  carried: number
}

export interface Seg {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  dx: number
  dy: number
  dz: number
  len: number
  parent: number
  depth: number
  thick: number
  stress: number
  growing: boolean
  children: number
}

export type Habit = 'cubic' | 'hex' | 'spire' | 'shard'

export interface Crystal {
  id: number
  anchor: number
  origin: Vec3
  habit: Habit
  /** Lattice orientation: a 3x3 rotation, row-major. */
  basis: number[]
  freq: number
  segs: Seg[]
  energy: number
  /** Lock-in detector for the signal at the crystal's own frequency. */
  iq: number
  qq: number
  vibMean: number
  resonance: number
  age: number
  name: string | null
  born: number
  /** Tracks regrowth after loss, for the Fracture Garden. */
  peak: number
  regrowFrom: number
}

export interface Fragment {
  id: number
  p: Vec3
  v: Vec3
  energy: number
  habit: Habit
  age: number
  freq: number
}

export type Family = 'membrane' | 'motile' | 'oscillating' | 'adaptive'
export type OrgState = 'explore' | 'feed' | 'flee' | 'rest' | 'dormant' | 'divide' | 'bond' | 'follow'

export interface Organism {
  id: number
  p: Vec3
  v: Vec3
  heading: Vec3
  energy: number
  age: number
  generation: number
  parent: number
  lineage: number
  genome: number[]
  family: Family
  state: OrgState
  stateTicks: number
  /** Learned sensitivity to disturbances (sensitisation), 0..1. */
  sens: number
  /** Last place food was good, remembered for a while. */
  memory: Vec3 | null
  memoryTicks: number
  phase: number
  flash: number
  util: number[]
  /** Where its current behaviour wants to go, and how fast. */
  desired: Vec3
  desiredSpeed: number
  sensed: { light: number; vibration: number; danger: number; kin: number; strand: number; food: number }
  held: boolean
  target: Vec3 | null
  anchor: number
  name: string | null
  born: number
  siphon: number
}

export interface Bond {
  a: number
  b: number
  age: number
}

export interface Ring {
  id: number
  members: number[]
  edges: number[]
  center: Vec3
  normal: Vec3
  radius: number
  coherence: number
  winding: number
  freq: number
  energy: number
  circulation: number
  age: number
  seen: number
  missed: number
  confirmed: boolean
  membrane: Membrane | null
  name: string | null
  born: number
  /** Member count history, for "changes form without losing identity". */
  sizes: number[]
}

export interface Membrane {
  energy: number
  radius: number
  permeability: number
  quickenings: number
  age: number
}

export interface Veil {
  id: number
  p: Vec3
  r: number
  ticks: number
  /** Bit flags: 1 radiance, 2 signal, 4 forces, 8 strand flow, 16 organisms. */
  mask: number
}

export interface PullField {
  id: number
  p: Vec3
  strength: number
  r: number
  ticks: number
}

export interface SimEvent {
  t: number
  type: string
  x: number
  y: number
  z: number
  a?: number
  b?: number
  value?: number
  text?: string
}

export interface Accounting {
  generated: number
  harvested: number
  dissipated: number
  converted: number
  /** Energy added or removed by the player directly (seeding, anchoring energy). */
  external: number
}

export interface Laws {
  phase: boolean
  mediators: boolean
  crystals: boolean
  membranes: boolean
  life: boolean
  adaptation: boolean
}

export interface WorldState {
  rulesVersion: number
  seed: number
  rng: number
  tick: number
  env: EnvId
  mode: Mode
  nextId: number
  nodes: SimNode[]
  strands: SimStrand[]
  crystals: Crystal[]
  fragments: Fragment[]
  organisms: Organism[]
  bonds: Bond[]
  /** Founding genome of each line of descent, for telling new kinds apart. */
  lineages: { id: number; genome: number[]; born: number }[]
  rings: Ring[]
  /** Rings lost in the last few seconds; a loop that re-forms from most of the same members is the same ring. */
  ghosts: { ring: Ring; lostAt: number }[]
  veils: Veil[]
  pulls: PullField[]
  field: { n: number; half: number; radiance: Float64Array; signal: Float32Array; signalVel: Float32Array }
  acct: Accounting
  laws: Laws
  /** Events emitted this tick and not yet collected by the host. */
  events: SimEvent[]
  /** Rolling record of notable events (for inspectors and discovery detectors). */
  log: SimEvent[]
  /** Fracture Garden: where a strand broke, so it can grow back. */
  scars: { a: number; b: number; t: number; rest: number }[]
  /** Environment drivers carry their own clocks. */
  envClock: number
  /** Ticks since the player last changed anything (for "self-sustaining" checks). */
  lastAction: number
  /** Population trait history, sampled every 5 seconds. */
  traitHistory: { t: number; means: number[]; count: number; maxGen: number }[]
  stats: { births: number; deaths: number; divisions: number; fractures: number; collapses: number; quickenings: number; maxGeneration: number }
  chamber: ChamberState | null
  /** Discovery types this universe has already reported, with the tick of first finding. */
  found: Record<string, number>
  /** Small counters the discovery detectors keep between checks. */
  memo: Record<string, number>
}

export interface ChamberState {
  id: string
  progress: number
  held: number
  done: boolean
  failed: string | null
  memo: Record<string, number>
  startedTick: number
  note: string
}
