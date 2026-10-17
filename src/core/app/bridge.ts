import type { AtlasEntry } from './atlas'
import type { Settings } from './settings'
import type { BudgetView, ChangeRequest, ChangeResult, LedgerEntry } from '../budget/controller'
import type { ModelRegistry } from '../budget/pricing'
import type { AiOutcome } from '../ai/service'

// The contract between the game window and whatever stores its data. The desktop app
// implements it in the main process (SQLite, Windows-protected key storage, the one AI
// sender). The browser preview implements it with browser storage and no AI. The window
// never sees an API key: no method here returns one.

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
}

export interface UniverseMeta {
  id: string
  name: string
  env: string
  mode: 'lab' | 'genesis' | 'chamber'
  preset: string
  seed: string
  created: number
  updated: number
  tick: number
  parent: string | null
  parentCheckpoint: string | null
  thumb: string | null
  notes: string
  chamber: string | null
  rules: number
  camera: CameraPose | null
}

export interface CheckpointMeta {
  id: string
  universeId: string
  label: string
  tick: number
  created: number
  thumb: string | null
}

export interface Exhibit {
  id: string
  name: string
  created: number
  thumb: string | null
  camera: CameraPose | null
  presentation: 'pedestal' | 'halo' | 'night'
  notes: string
  sourceUniverse: string | null
  env: string
}

export interface ChamberProgress {
  solved: boolean
  bestSeconds: number | null
  attempts: number
}

export interface AiStatus {
  available: boolean
  enabled: boolean
  keyPresent: boolean
  mock: boolean
  lightModel: string
  deepModel: string
  allowDeep: boolean
  note: string
}

export interface AiContext {
  userInitiated: boolean
  enrich?: boolean
  deep?: boolean
}

export interface SaveResult<T> {
  ok: boolean
  value?: T
  error?: string
  recovered?: boolean
}

export interface Bridge {
  kind: 'desktop' | 'web'
  version: string
  settings: {
    get(): Promise<Settings>
    set(s: Settings): Promise<Settings>
  }
  universes: {
    list(): Promise<UniverseMeta[]>
    save(meta: UniverseMeta, state: string): Promise<SaveResult<UniverseMeta>>
    load(id: string): Promise<SaveResult<{ meta: UniverseMeta; state: string }>>
    remove(id: string): Promise<boolean>
    rename(id: string, name: string): Promise<boolean>
    checkpoints(universeId: string): Promise<CheckpointMeta[]>
    saveCheckpoint(cp: CheckpointMeta, state: string): Promise<SaveResult<CheckpointMeta>>
    loadCheckpoint(id: string): Promise<SaveResult<string>>
    removeCheckpoint(id: string): Promise<boolean>
    exportFile(id: string): Promise<SaveResult<string>>
    importFile(): Promise<SaveResult<UniverseMeta>>
  }
  atlas: {
    list(): Promise<AtlasEntry[]>
    record(e: AtlasEntry): Promise<{ entry: AtlasEntry; isNew: boolean }>
    update(id: string, patch: Partial<Pick<AtlasEntry, 'notes' | 'customName' | 'ai' | 'image'>>): Promise<AtlasEntry | null>
  }
  gallery: {
    list(): Promise<Exhibit[]>
    save(e: Exhibit, state: string): Promise<SaveResult<Exhibit>>
    load(id: string): Promise<SaveResult<{ exhibit: Exhibit; state: string }>>
    update(id: string, patch: Partial<Pick<Exhibit, 'name' | 'notes' | 'presentation' | 'camera' | 'thumb'>>): Promise<Exhibit | null>
    remove(id: string): Promise<boolean>
  }
  chambers: {
    progress(): Promise<Record<string, ChamberProgress>>
    record(id: string, solved: boolean, seconds: number | null): Promise<Record<string, ChamberProgress>>
  }
  files: {
    saveImage(dataUrl: string, suggestedName: string): Promise<SaveResult<string>>
    saveText(text: string, suggestedName: string, kind: 'csv' | 'txt'): Promise<SaveResult<string>>
    openSavesFolder(): Promise<boolean>
  }
  ai: {
    status(): Promise<AiStatus>
    setEnabled(on: boolean): Promise<AiStatus>
    setKey(key: string): Promise<{ ok: boolean; error?: string }>
    clearKey(): Promise<AiStatus>
    checkKey(): Promise<{ ok: boolean; message: string }>
    run(feature: string, input: unknown, ctx: AiContext): Promise<AiOutcome>
    cancel(): Promise<void>
    budget: {
      view(): Promise<BudgetView>
      propose(req: ChangeRequest): Promise<ChangeResult>
      confirm(token: string): Promise<ChangeResult>
      ledger(limit: number): Promise<LedgerEntry[]>
      exportCsv(): Promise<SaveResult<string>>
    }
    registry: {
      get(): Promise<{ bundled: ModelRegistry; user: ModelRegistry | null }>
      set(reg: ModelRegistry | null): Promise<{ ok: boolean; error?: string }>
    }
  }
  app: {
    quit(): Promise<void>
    setFullscreen(on: boolean): Promise<boolean>
    openLink(which: 'models' | 'pricing' | 'workspaces' | 'console'): Promise<void>
    selftest?: (report: Record<string, unknown>) => Promise<void>
    isSelftest(): Promise<boolean>
    /** Desktop only: run this (e.g. save) when the player closes the window, before it closes. */
    onClosing?: (cb: () => Promise<void>) => void
  }
}

export const DOC_LINKS: Record<'models' | 'pricing' | 'workspaces' | 'console', string> = {
  models: 'https://platform.claude.com/docs/en/models/overview',
  pricing: 'https://platform.claude.com/docs/en/about-claude/pricing',
  workspaces: 'https://platform.claude.com/docs/en/manage-claude/workspaces',
  console: 'https://platform.claude.com/'
}
