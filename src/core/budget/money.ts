// Money is kept in whole microdollars (1 USD = 1,000,000). Every amount in the
// ledger is a safe integer, so no rounding drift can ever accumulate.

export type Micro = number

export const MICRO_PER_USD = 1_000_000

export function usd(dollars: number): Micro {
  if (!Number.isFinite(dollars)) throw new Error('Amount must be a finite number')
  return Math.round(dollars * MICRO_PER_USD)
}

export function toUsd(m: Micro): number {
  return m / MICRO_PER_USD
}

export function isMicro(m: unknown): m is Micro {
  return typeof m === 'number' && Number.isSafeInteger(m) && m >= 0
}

export function assertMicro(m: unknown, what = 'amount'): asserts m is Micro {
  if (!isMicro(m)) throw new Error(`${what} must be a non-negative whole number of microdollars`)
}

/** "$0.0123" style, with enough digits that tiny game requests do not read as $0.00. */
export function formatUsd(m: Micro, digits?: number): string {
  const d = toUsd(m)
  const places = digits ?? (Math.abs(d) >= 1 ? 2 : Math.abs(d) >= 0.01 ? 3 : 4)
  return `$${d.toFixed(places)}`
}

/** Cost of `tokens` at `pricePerMTok` microdollars per million tokens, rounded UP. */
export function tokenCost(tokens: number, pricePerMTok: Micro): Micro {
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('Token count must be a non-negative integer')
  assertMicro(pricePerMTok, 'price')
  const product = tokens * pricePerMTok
  if (!Number.isSafeInteger(product)) throw new Error('Cost overflow')
  return Math.ceil(product / 1_000_000)
}

/** Multiply by a factor given in thousandths (1100 = 1.1x), rounding up. */
export function scalePermille(m: Micro, permille: number): Micro {
  assertMicro(m)
  if (!Number.isSafeInteger(permille) || permille < 1000) throw new Error('Safety factor must be at least 1000 permille')
  return Math.ceil((m * permille) / 1000)
}
