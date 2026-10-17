import { assertMicro, isMicro, type Micro } from './money'

// The trusted model registry. Prices are microdollars per million tokens.
//
// Verified against https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-17:
//   Claude Haiku 5.5  (prompts up to 100,000 tokens): $0.10 in, $0.125 5m cache write,
//                      $0.20 1h cache write, $0.01 cache read, $0.50 out
//   Claude Haiku 5.5  (prompts over 100,000 tokens):  $0.50 / $0.625 / $1 / $0.05 / $2.50
//   Claude Sonnet 5.5: $2 in, $2.50 5m write, $4 1h write, $0.10 cache read, $10 out
//   inference_geo "us" adds 1.1x (Polaritium never sets it; the safety factor covers it anyway).
//
// The player may raise a price (if Anthropic raises theirs) but can never lower one below
// these bundled figures: admission always uses the higher of the two. A model missing any
// price is unknown and every request to it is refused.

export interface ModelPrice {
  model: string
  label: string
  inputPerMTok: Micro
  cacheWrite5mPerMTok: Micro
  cacheWrite1hPerMTok: Micro
  cacheReadPerMTok: Micro
  outputPerMTok: Micro
  /** Prompts above this many tokens are billed at the long tier (Haiku 5.5 only). */
  longPromptThreshold?: number
  long?: Omit<ModelPrice, 'model' | 'label' | 'long' | 'longPromptThreshold' | 'premium' | 'tier'>
  premium: boolean
  tier: 'light' | 'deep' | 'premium'
}

export interface ModelRegistry {
  version: number
  verifiedOn: string
  source: string
  models: Record<string, ModelPrice>
}

export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'

export const BUNDLED_REGISTRY: ModelRegistry = {
  version: 1,
  verifiedOn: '2026-10-17',
  source: PRICING_SOURCE,
  models: {
    'claude-haiku-5-5': {
      model: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      inputPerMTok: 100_000,
      cacheWrite5mPerMTok: 125_000,
      cacheWrite1hPerMTok: 200_000,
      cacheReadPerMTok: 10_000,
      outputPerMTok: 500_000,
      longPromptThreshold: 100_000,
      long: {
        inputPerMTok: 500_000,
        cacheWrite5mPerMTok: 625_000,
        cacheWrite1hPerMTok: 1_000_000,
        cacheReadPerMTok: 50_000,
        outputPerMTok: 2_500_000
      },
      premium: false,
      tier: 'light'
    },
    'claude-sonnet-5-5': {
      model: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      inputPerMTok: 2_000_000,
      cacheWrite5mPerMTok: 2_500_000,
      cacheWrite1hPerMTok: 4_000_000,
      cacheReadPerMTok: 100_000,
      outputPerMTok: 10_000_000,
      premium: false,
      tier: 'deep'
    }
  }
}

export const DEFAULT_LIGHT_MODEL = 'claude-haiku-5-5'
export const DEFAULT_DEEP_MODEL = 'claude-sonnet-5-5'

const PRICE_KEYS = ['inputPerMTok', 'cacheWrite5mPerMTok', 'cacheWrite1hPerMTok', 'cacheReadPerMTok', 'outputPerMTok'] as const

export function isPremiumModelId(model: string): boolean {
  return /opus|fable|mythos/i.test(model)
}

/** A price entry is usable only if every component is a positive whole microdollar figure. */
export function validPrice(p: Partial<ModelPrice> | undefined): p is ModelPrice {
  if (!p || typeof p.model !== 'string') return false
  for (const k of PRICE_KEYS) {
    const v = p[k]
    if (!isMicro(v) || v <= 0) return false
  }
  if (p.long) {
    for (const k of PRICE_KEYS) {
      const v = p.long[k]
      if (!isMicro(v) || v <= 0) return false
    }
  }
  return true
}

/**
 * The price admission actually uses: the higher of the bundled and the player's figure for
 * every component. Returns null (blocked) when the model has no complete, valid price.
 */
export function effectivePrice(model: string, user: ModelRegistry | null): ModelPrice | null {
  const bundled = BUNDLED_REGISTRY.models[model]
  const custom = user?.models?.[model]
  const b = validPrice(bundled) ? bundled : null
  const c = validPrice(custom) ? custom : null
  if (!b && !c) return null
  if (b && !c) return b
  if (!b && c) return { ...c, premium: c.premium || isPremiumModelId(model) }
  const out: ModelPrice = { ...b! }
  for (const k of PRICE_KEYS) out[k] = Math.max(b![k], c![k])
  if (b!.long || c!.long) {
    const bl = b!.long ?? b!
    const cl = c!.long ?? c!
    out.long = {
      inputPerMTok: Math.max(bl.inputPerMTok, cl.inputPerMTok),
      cacheWrite5mPerMTok: Math.max(bl.cacheWrite5mPerMTok, cl.cacheWrite5mPerMTok),
      cacheWrite1hPerMTok: Math.max(bl.cacheWrite1hPerMTok, cl.cacheWrite1hPerMTok),
      cacheReadPerMTok: Math.max(bl.cacheReadPerMTok, cl.cacheReadPerMTok),
      outputPerMTok: Math.max(bl.outputPerMTok, cl.outputPerMTok)
    }
  }
  out.premium = b!.premium || c!.premium || isPremiumModelId(model)
  return out
}

/** Validates a registry the player edited. Throws with a plain explanation on any bad value. */
export function validateUserRegistry(r: unknown): ModelRegistry {
  if (!r || typeof r !== 'object') throw new Error('The price list is not readable.')
  const reg = r as ModelRegistry
  if (!reg.models || typeof reg.models !== 'object') throw new Error('The price list has no models.')
  for (const [id, p] of Object.entries(reg.models)) {
    if (!validPrice(p)) throw new Error(`The price for ${id} is incomplete or not a positive amount.`)
    if (p.model !== id) throw new Error(`The entry for ${id} names a different model.`)
    for (const k of PRICE_KEYS) assertMicro(p[k], `${id} ${k}`)
  }
  return {
    version: Number(reg.version) || 1,
    verifiedOn: String(reg.verifiedOn || ''),
    source: String(reg.source || ''),
    models: reg.models
  }
}
