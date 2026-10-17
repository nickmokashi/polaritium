import { scalePermille, tokenCost, type Micro } from './money'
import type { ModelPrice } from './pricing'

// Conservative bounds on what one request can cost, worked out before anything is sent.
//
// Input tokens: Claude's tokenizers turn text into tokens of at least one byte each, so the
// UTF-8 byte count of every piece of text is an upper bound on the tokens it can become. A
// fixed allowance per message and per request covers the message framing.
//
// Every input token is priced at the highest input rate the model has (the 1-hour cache
// write), even though Polaritium never asks for caching, so an unexpected cache write can
// never cost more than was reserved. Output is priced at max_tokens, which the API enforces
// as a hard ceiling (thinking counts toward it). A 1.1x safety factor sits on top.

export const MAX_INPUT_TOKENS = 20_000
export const MAX_OUTPUT_TOKENS_CAP = 1_500
export const FRAMING_TOKENS_PER_MESSAGE = 16
export const FRAMING_TOKENS_PER_REQUEST = 96
export const SAFETY_PERMILLE = 1_100

export interface RequestPlan {
  feature: string
  model: string
  system: string
  messages: { role: 'user' | 'assistant'; text: string }[]
  /** JSON schema text sent for structured output, counted as input. */
  schemaText?: string
  maxOutputTokens: number
}

export function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

export function inputTokenBound(plan: RequestPlan): number {
  let n = FRAMING_TOKENS_PER_REQUEST + utf8Bytes(plan.system)
  if (plan.schemaText) n += utf8Bytes(plan.schemaText)
  for (const m of plan.messages) n += FRAMING_TOKENS_PER_MESSAGE + utf8Bytes(m.text)
  return n
}

function rates(price: ModelPrice, promptTokens: number) {
  if (price.long && price.longPromptThreshold !== undefined && promptTokens > price.longPromptThreshold) {
    return price.long
  }
  return price
}

/** The most this request could possibly cost, in microdollars (rounded up, safety factor included). */
export function maxRequestCost(plan: RequestPlan, price: ModelPrice): { inputBound: number; cost: Micro } {
  const inputBound = inputTokenBound(plan)
  const r = rates(price, inputBound)
  const inputRate = Math.max(r.inputPerMTok, r.cacheWrite5mPerMTok, r.cacheWrite1hPerMTok)
  const raw = tokenCost(inputBound, inputRate) + tokenCost(plan.maxOutputTokens, r.outputPerMTok)
  return { inputBound, cost: scalePermille(raw, SAFETY_PERMILLE) }
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  /** Split of cache writes by lifetime, when the API reports it. */
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null
}

export function isCompleteUsage(u: unknown): u is Usage {
  if (!u || typeof u !== 'object') return false
  const x = u as Usage
  return Number.isSafeInteger(x.input_tokens) && x.input_tokens >= 0 && Number.isSafeInteger(x.output_tokens) && x.output_tokens >= 0
}

/** The actual cost of a finished request from the usage the API reported (no safety factor). */
export function actualCost(usage: Usage, price: ModelPrice): Micro {
  const cacheRead = Math.max(0, usage.cache_read_input_tokens ?? 0)
  const cacheWrite = Math.max(0, usage.cache_creation_input_tokens ?? 0)
  const prompt = usage.input_tokens + cacheRead + cacheWrite
  const r = rates(price, prompt)
  // Without a split we price every cache write at the 1-hour rate (the higher one).
  const w5 = Math.max(0, usage.cache_creation?.ephemeral_5m_input_tokens ?? 0)
  const w1 = usage.cache_creation ? Math.max(0, cacheWrite - w5) : cacheWrite
  return (
    tokenCost(usage.input_tokens, r.inputPerMTok) +
    tokenCost(cacheRead, r.cacheReadPerMTok) +
    tokenCost(w5, r.cacheWrite5mPerMTok) +
    tokenCost(w1, r.cacheWrite1hPerMTok) +
    tokenCost(usage.output_tokens, r.outputPerMTok)
  )
}
