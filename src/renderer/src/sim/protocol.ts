import type { AtlasEntry } from '@core/app/atlas'
import type { Command, CommandResult } from '@core/sim/commands'
import type { RenderSnapshot } from '@core/sim/snapshot'
import type { ChamberState, EnvId, Laws, Mode } from '@core/sim/types'

export type ToWorker =
  | { t: 'create'; seed: string; env: EnvId; mode: Mode; preset: string; density: number; chamber?: string | null }
  | { t: 'load'; state: string }
  | { t: 'universe'; id: string | null; name: string | null }
  | { t: 'advance'; ticks: number; fields: boolean; budgetMs: number }
  | { t: 'cmd'; id: number; cmd: Command; undoable: boolean }
  | { t: 'req'; id: number; op: string; args?: unknown }

export interface FrameInfo {
  tick: number
  ticks: number
  ms: number
  chamber: ChamberState | null
  laws: Laws
  env: EnvId
  mode: Mode
  found: string[]
  canUndo: boolean
  canRedo: boolean
}

export type FromWorker =
  | { t: 'frame'; snap: RenderSnapshot; info: FrameInfo; findings: AtlasEntry[] }
  | { t: 'res'; id: number; result: unknown; error?: string }
  | { t: 'ready'; info: FrameInfo }

export type { CommandResult }
