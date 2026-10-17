// The rules of the medium. Changing any number here changes how every universe behaves, so
// RULES_VERSION goes up on purpose whenever behaviour changes (saved worlds record it).

export const RULES_VERSION = 1
export const SAVE_SCHEMA = 2

/** Simulation seconds per tick. 30 ticks make one second at normal speed. */
export const DT = 1 / 30
export const TICKS_PER_SECOND = 30
/** A cycle is the game's unit of experimental time: 60 ticks, two simulation seconds. */
export const TICKS_PER_CYCLE = 60

export const FIELD_N = 24

// Node expressions
export const CAPACITY_PER_MASS = { black: 60, white: 20, grey: 10 } as const
export const BASE_FREQ = { black: 0.25, white: 0.6, grey: 0.4 } as const
export const MASS_MIN = 0.15
export const MASS_MAX = 6
export const FREQ_MIN = 0.05
export const FREQ_MAX = 2.5

export const WHITE_GEN_RATE = 5.0 // energy per second per unit mass, scaled by (1 - fill)
export const WHITE_RADIATE = 0.45 // fraction of stored energy radiated per second
export const BLACK_INTAKE = 0.5 // per second per unit mass, times local radiance and (1 - fill)
export const BLACK_LEAK = 0.0005 // retention: almost nothing leaks
export const BLACK_SATURATION = 0.97
export const BLACK_COLLAPSE_TICKS = 150 // 5 s held at saturation
export const WHITE_OVERLOAD_TICKS = 240 // 8 s held overfull while stressed
export const GREY_FIRE_FILL = 0.35
export const GREY_FIRE_RELEASE = 0.5
export const GREY_STARVE_TICKS = 900 // 30 s nearly empty and a mediator begins to dissolve
export const GREY_PULSE_COUPLING = 0.3

// Mechanics
export const GRAVITY = 60
export const PRESSURE = 50
export const SOFTENING = 3
export const FORCE_CUTOFF = 34
export const COLLISION_K = 30
export const MAX_SPEED = 25
export const TWIST_DRIVE = 0.25

// Strands (an RLC-like transfer path)
export const STRAND_DRIVE = 12 // S: how hard a potential difference pushes flow
export const STRAND_INERTIA = 1 // L: flow has momentum, so strong couplings can ring
export const PHASE_GAIN = 1.5
export const STRAND_MAX_PER_NODE = 6
export const STRAND_SPRING = 2.0
export const STRAND_DAMP = 0.4
export const STRAND_MAX_CURRENT_PER_STRENGTH = 8
export const LOCK_RATE = 0.2 // rad/s: phase difference drifting slower than this counts as locked
export const HEBB_RATE = 0.004
export const IDLE_DECAY = 0.01
export const BIRTH_LOCK_TICKS = 450 // 15 s of resonance with sustained flow births a mediator
export const BIRTH_MIN_FLOW = 0.8

// Structures
export const RING_LOCK_TICKS = 45
export const RING_CONFIRM_CHECKS = 4
export const STRUCTURE_INTERVAL = 15
export const MEMBRANE_COHERENCE = 0.9
export const MEMBRANE_ENERGY = 35
export const MEMBRANE_AGE = 300
export const QUICKEN_ENERGY = 60

// Crystals
export const CRYSTAL_SEG_LEN = 3
export const CRYSTAL_MAX_SEGS = 90
export const CRYSTAL_MAX_DEPTH = 7

// Organisms
export const GENES = 13
export const ORGANISM_DECIDE_EVERY = 4

// Capacities (bounded counts; raised only after profiling)
export const LIMITS = {
  nodes: 260,
  strands: 700,
  organisms: 220,
  crystals: 24,
  crystalSegments: 1600,
  fragments: 120,
  veils: 6,
  events: 400
}

export const ANCHOR_POS = 1
export const ANCHOR_PHASE = 2
export const ANCHOR_ENERGY = 4
