// Player settings. Stored by the desktop app (SQLite) or the browser preview (local storage).

export type Quality = 'low' | 'balanced' | 'high' | 'ultra'

export interface Settings {
  version: 1
  graphics: { quality: Quality; bloom: boolean; dust: number; reflections: boolean; fpsCap: 30 | 60; resolution: number }
  display: { fullscreen: boolean; uiScale: number }
  audio: { master: number; ambience: number; effects: number; interface: number; muted: boolean }
  controls: { orbitSpeed: number; flySpeed: number; zoomSpeed: number; invertY: boolean; dragAlternative: boolean }
  access: { reduceMotion: boolean; reduceFlashing: boolean; highContrast: boolean; largeText: boolean; captions: boolean }
  data: { autosaveMinutes: number }
  tutorialDone: boolean
  lastUniverse: string | null
}

export const QUALITY_PRESETS: Record<Quality, Settings['graphics']> = {
  low: { quality: 'low', bloom: false, dust: 2500, reflections: false, fpsCap: 30, resolution: 0.75 },
  balanced: { quality: 'balanced', bloom: true, dust: 6000, reflections: false, fpsCap: 60, resolution: 1 },
  high: { quality: 'high', bloom: true, dust: 12000, reflections: true, fpsCap: 60, resolution: 1 },
  ultra: { quality: 'ultra', bloom: true, dust: 22000, reflections: true, fpsCap: 60, resolution: 1.25 }
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    graphics: { ...QUALITY_PRESETS.balanced },
    display: { fullscreen: false, uiScale: 1 },
    audio: { master: 0.8, ambience: 0.7, effects: 0.8, interface: 0.6, muted: false },
    controls: { orbitSpeed: 1, flySpeed: 1, zoomSpeed: 1, invertY: false, dragAlternative: false },
    access: { reduceMotion: false, reduceFlashing: false, highContrast: false, largeText: false, captions: false },
    data: { autosaveMinutes: 3 },
    tutorialDone: false,
    lastUniverse: null
  }
}

const clamp = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d)

/** Accepts anything and returns valid settings, keeping what was valid. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const g = (r.graphics ?? {}) as Partial<Settings['graphics']>
  const q = (['low', 'balanced', 'high', 'ultra'] as Quality[]).includes(g.quality as Quality) ? (g.quality as Quality) : d.graphics.quality
  const a = (r.audio ?? {}) as Partial<Settings['audio']>
  const c = (r.controls ?? {}) as Partial<Settings['controls']>
  const x = (r.access ?? {}) as Partial<Settings['access']>
  return {
    version: 1,
    graphics: {
      quality: q,
      bloom: bool(g.bloom, QUALITY_PRESETS[q].bloom),
      dust: clamp(g.dust, 0, 30000, QUALITY_PRESETS[q].dust),
      reflections: bool(g.reflections, QUALITY_PRESETS[q].reflections),
      fpsCap: g.fpsCap === 30 ? 30 : 60,
      resolution: clamp(g.resolution, 0.5, 1.5, QUALITY_PRESETS[q].resolution)
    },
    display: { fullscreen: bool(r.display?.fullscreen, d.display.fullscreen), uiScale: clamp(r.display?.uiScale, 0.8, 1.6, 1) },
    audio: {
      master: clamp(a.master, 0, 1, d.audio.master),
      ambience: clamp(a.ambience, 0, 1, d.audio.ambience),
      effects: clamp(a.effects, 0, 1, d.audio.effects),
      interface: clamp(a.interface, 0, 1, d.audio.interface),
      muted: bool(a.muted, false)
    },
    controls: {
      orbitSpeed: clamp(c.orbitSpeed, 0.2, 3, 1),
      flySpeed: clamp(c.flySpeed, 0.2, 3, 1),
      zoomSpeed: clamp(c.zoomSpeed, 0.2, 3, 1),
      invertY: bool(c.invertY, false),
      dragAlternative: bool(c.dragAlternative, false)
    },
    access: {
      reduceMotion: bool(x.reduceMotion, false),
      reduceFlashing: bool(x.reduceFlashing, false),
      highContrast: bool(x.highContrast, false),
      largeText: bool(x.largeText, false),
      captions: bool(x.captions, false)
    },
    data: { autosaveMinutes: clamp(r.data?.autosaveMinutes, 0, 30, 3) },
    tutorialDone: bool(r.tutorialDone, false),
    lastUniverse: typeof r.lastUniverse === 'string' ? r.lastUniverse : null
  }
}
