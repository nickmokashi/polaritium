import { create } from 'zustand'
import type { AtlasEntry } from '@core/app/atlas'
import type { UniverseMeta, Exhibit } from '@core/app/bridge'
import { defaultSettings, type Settings } from '@core/app/settings'
import type { Reading } from '@core/sim/inspect'
import type { ToolId } from '@core/sim/chambers'
import type { EnvId, Mode } from '@core/sim/types'
import type { FrameInfo } from '../sim/protocol'

export type Screen = 'menu' | 'new' | 'game' | 'chambers' | 'gallery' | 'atlas' | 'settings' | 'compare' | 'exhibit'
export type SeedKind = 'white' | 'black' | 'grey' | 'crystal' | 'life'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'discovery' | 'warn' | 'law'
  entry?: AtlasEntry
}

export interface GameSpec {
  mode: Mode
  env: EnvId
  preset: string
  seed: string
  density: number
  name: string
  chamber: string | null
  loadState?: string
  universe?: UniverseMeta | null
  exhibit?: Exhibit | null
}

interface UI {
  screen: Screen
  settings: Settings
  spec: GameSpec | null
  universe: UniverseMeta | null
  tool: ToolId
  seedKind: SeedKind
  seedMass: number
  sporeType: string
  pulseStrength: number
  veilRadius: number
  veilMask: number
  veilSeconds: number
  anchorFlags: number
  selection: number[]
  hover: number | null
  reading: Reading | null
  sight: boolean
  lens: boolean
  paused: boolean
  speed: number
  info: FrameInfo | null
  toasts: Toast[]
  captions: { id: number; text: string }[]
  atlas: AtlasEntry[]
  helpOpen: boolean
  tutorialStep: number
  dialog: null | { kind: string; data?: unknown }
  pendingStrand: number | null
  set: (p: Partial<UI>) => void
  toast: (text: string, kind?: Toast['kind'], entry?: AtlasEntry) => void
  caption: (text: string) => void
}

let toastId = 1

export const useUI = create<UI>((set, get) => ({
  screen: 'menu',
  settings: defaultSettings(),
  spec: null,
  universe: null,
  tool: 'hand',
  seedKind: 'white',
  seedMass: 1,
  sporeType: 'swimmer',
  pulseStrength: 4,
  veilRadius: 10,
  veilMask: 31,
  veilSeconds: 30,
  anchorFlags: 1,
  selection: [],
  hover: null,
  reading: null,
  sight: false,
  lens: false,
  paused: false,
  speed: 1,
  info: null,
  toasts: [],
  captions: [],
  atlas: [],
  helpOpen: false,
  tutorialStep: -1,
  dialog: null,
  pendingStrand: null,
  set: (p) => set(p),
  toast: (text, kind = 'info', entry) => {
    const t: Toast = { id: toastId++, text, kind, entry }
    set({ toasts: [...get().toasts.slice(-3), t] })
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), kind === 'discovery' || kind === 'law' ? 7000 : 4200)
  },
  caption: (text) => {
    const c = { id: toastId++, text }
    set({ captions: [...get().captions.slice(-2), c] })
    setTimeout(() => set({ captions: get().captions.filter((x) => x.id !== c.id) }), 2600)
  }
}))
