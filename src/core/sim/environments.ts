import type { EnvId } from './types'

// Five places, each with its own physics, not a recolour. What differs is listed in
// `distinct`, which the in-game environment cards show and a test checks.

export type Boundary = 'soft' | 'reflect' | 'absorb' | 'well' | 'split'

export interface EnvParams {
  id: EnvId
  name: string
  line: string
  distinct: string[]
  radius: number
  boundary: Boundary
  /** Velocity damping per second. */
  viscosity: number
  /** Phase noise (variability) in rad per sqrt(second). */
  noise: number
  /** Constant radiance source density across the chamber (energy per cell per second). */
  ambient: number
  radianceDecay: number
  radianceDiffusion: number
  waveSpeed: number
  waveDamping: number
  /** Restoring term on the signal field (a soft "spring" for standing waves). */
  waveStiffness: number
  /** Distance below which strands can form on their own, and how readily. */
  formDist: number
  formRate: number
  /** Strand strength multiplier (below 1 breaks more easily) and stress gain. */
  strandStrength: number
  stressGain: number
  /** Fracture Garden: broken strands grow back, fragments reseed. */
  regrowth: boolean
  /** Stillness Well: central pull. */
  gravityWell: number
  /** Cathedral: natural frequencies drift toward the harmonic series of this base (Hz), 0 = off. */
  harmonicBase: number
  /** Fracture Garden: periodic quakes (seconds between, strength). */
  quakePeriod: number
  quakeStrength: number
  /** Threshold: a moving boundary plane between a bright and a dark half. */
  thresholdAmp: number
  thresholdPeriod: number
  crystalNucleation: number
  crystalGrowth: number
  stillnessLimit: number
  /** Multiplies the energy a membrane needs before life quickens in it. */
  lifeEase: number
  maxOrganisms: number
  /** Visual and sound character, read by the renderer and audio engine. */
  look: { fog: number; tint: [number, number, number]; floor: 'none' | 'mirror' | 'shards' | 'basin' | 'divide' | 'dust'; ambience: string }
}

const base: Omit<EnvParams, 'id' | 'name' | 'line' | 'distinct' | 'look'> = {
  radius: 60,
  boundary: 'soft',
  viscosity: 0.35,
  noise: 0.12,
  ambient: 0,
  radianceDecay: 0.08,
  radianceDiffusion: 8,
  waveSpeed: 24,
  waveDamping: 0.35,
  waveStiffness: 0,
  formDist: 16,
  formRate: 0.02,
  strandStrength: 1,
  stressGain: 1,
  regrowth: false,
  gravityWell: 0,
  harmonicBase: 0,
  quakePeriod: 0,
  quakeStrength: 0,
  thresholdAmp: 0,
  thresholdPeriod: 0,
  crystalNucleation: 0.04,
  crystalGrowth: 1,
  stillnessLimit: 0.6,
  lifeEase: 1,
  maxOrganisms: 180
}

export const ENVIRONMENTS: Record<EnvId, EnvParams> = {
  cradle: {
    ...base,
    id: 'cradle',
    name: 'The Void Cradle',
    line: 'A sparse dark where even weak attractions show as threads of light.',
    distinct: [
      'Very little drag: things drift a long way once pushed.',
      'Strands form on their own across long distances, faint at first.',
      'Weak, spontaneous strands fade unless energy keeps flowing through them.'
    ],
    radius: 70,
    viscosity: 0.12,
    noise: 0.1,
    formDist: 24,
    formRate: 0.05,
    radianceDecay: 0.06,
    look: { fog: 0.008, tint: [0.62, 0.64, 0.7], floor: 'dust', ambience: 'cradle' }
  },
  cathedral: {
    ...base,
    id: 'cathedral',
    name: 'The Resonance Cathedral',
    line: 'Mirrored crystal walls where every vibration comes back to you.',
    distinct: [
      'Walls reflect signals instead of swallowing them, so standing waves build.',
      'Natural frequencies slowly settle onto a harmonic series: things want to sing together.',
      'Little damping on vibration; crystals here grow as tall spires.'
    ],
    radius: 55,
    boundary: 'reflect',
    viscosity: 0.4,
    noise: 0.06,
    waveDamping: 0.06,
    waveStiffness: 0.15,
    harmonicBase: 0.2,
    crystalNucleation: 0.08,
    look: { fog: 0.012, tint: [0.72, 0.74, 0.82], floor: 'mirror', ambience: 'cathedral' }
  },
  garden: {
    ...base,
    id: 'garden',
    name: 'The Fracture Garden',
    line: 'Everything here breaks easily, and what breaks grows back.',
    distinct: [
      'Strands are brittle and stress builds fast.',
      'Periodic quakes roll through the chamber.',
      'Broken strands regrow if their ends stay close; crystal shards reseed new crystals.'
    ],
    radius: 60,
    boundary: 'absorb',
    strandStrength: 0.6,
    stressGain: 1.8,
    regrowth: true,
    quakePeriod: 14,
    quakeStrength: 3.2,
    crystalNucleation: 0.1,
    crystalGrowth: 1.6,
    stillnessLimit: 1.2,
    look: { fog: 0.014, tint: [0.7, 0.66, 0.62], floor: 'shards', ambience: 'garden' }
  },
  well: {
    ...base,
    id: 'well',
    name: 'The Stillness Well',
    line: 'A low, heavy calm where the smallest disturbance can last a very long time.',
    distinct: [
      'Thick drag and almost no noise: patterns persist.',
      'Signals barely fade, and energy is scarce.',
      'A slow pull draws everything toward the deep centre.'
    ],
    radius: 50,
    boundary: 'well',
    viscosity: 1.1,
    noise: 0.015,
    radianceDecay: 0.03,
    waveDamping: 0.02,
    waveSpeed: 16,
    gravityWell: 0.35,
    formDist: 12,
    crystalNucleation: 0.06,
    crystalGrowth: 0.7,
    stillnessLimit: 0.35,
    lifeEase: 0.8,
    look: { fog: 0.02, tint: [0.55, 0.58, 0.62], floor: 'basin', ambience: 'well' }
  },
  threshold: {
    ...base,
    id: 'threshold',
    name: 'The Threshold',
    line: 'A bright half and a dark half, and a moving edge between them where things change.',
    distinct: [
      'One half is flooded with radiance, the other drinks it.',
      'The dividing plane sweeps back and forth.',
      'Things that stay on one side long enough change expression: dark turns light, light turns dark.'
    ],
    radius: 60,
    boundary: 'split',
    viscosity: 0.3,
    noise: 0.18,
    ambient: 0.05,
    thresholdAmp: 22,
    thresholdPeriod: 40,
    formRate: 0.03,
    look: { fog: 0.01, tint: [0.66, 0.66, 0.66], floor: 'divide', ambience: 'threshold' }
  },
  genesis: {
    ...base,
    id: 'genesis',
    name: 'The First Dark',
    line: 'Almost nothing. The laws of the medium wake as you find them.',
    distinct: ['Begins with only light, dark and attraction.', 'Each discovery wakes a new law of the medium.'],
    radius: 58,
    viscosity: 0.2,
    noise: 0.08,
    formDist: 20,
    formRate: 0.04,
    look: { fog: 0.01, tint: [0.6, 0.6, 0.64], floor: 'dust', ambience: 'genesis' }
  }
}

export const PLAYABLE_ENVS: EnvId[] = ['cradle', 'cathedral', 'garden', 'well', 'threshold']

export function envOf(id: EnvId): EnvParams {
  return ENVIRONMENTS[id] ?? ENVIRONMENTS.cradle
}

/** Threshold: where the dividing plane is (x coordinate) at a given environment time. */
export function thresholdPlane(env: EnvParams, envClock: number): number {
  if (!env.thresholdPeriod) return 0
  return env.thresholdAmp * Math.sin((2 * Math.PI * envClock) / env.thresholdPeriod)
}
