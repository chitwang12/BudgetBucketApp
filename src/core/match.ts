import type { CycleBounds } from './cycle.ts'
import { dueWindowInCycle } from './cycle.ts'
import { addDays, type IsoDate } from './dates.ts'
import type { Paise } from './money.ts'
import type { Bucket } from './types.ts'

export interface MerchantRule {
  id: string
  pattern: string
  bucketId: string
}

export const AUTO_APPLY_CONFIDENCE = 0.8
const DUE_WINDOW_SLACK_DAYS = 5

/** Lower-cases and strips UPI handles and punctuation so "SWIGGY@icici" and "Swiggy " compare equal. */
export function normaliseMerchant(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/@[\w.-]+$/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The longest rule pattern found in the merchant wins, so "amazon pay" beats "amazon". */
export function matchRule(rules: readonly MerchantRule[], merchant: string): MerchantRule | null {
  const name = normaliseMerchant(merchant)
  let best: MerchantRule | null = null
  for (const rule of rules) {
    const pattern = normaliseMerchant(rule.pattern)
    if (pattern && name.includes(pattern) && (!best || pattern.length > best.pattern.length)) best = rule
  }
  return best
}

/**
 * Matches a debit to a committed, bill or sinking bucket by keyword. Confidence is high when the
 * amount fits what is still owed and the date is near the due window; otherwise it is only a suggestion.
 */
export function matchCommitted(params: {
  buckets: readonly (Bucket & { matchKeywords: readonly string[] })[]
  text: string
  amount: Paise
  today: IsoDate
  cycle: CycleBounds
  stillOwed: (bucketId: string) => Paise
}): { bucketId: string; confidence: number } | null {
  const haystack = normaliseMerchant(params.text)
  for (const bucket of params.buckets) {
    if (!['committed', 'bill', 'sinking'].includes(bucket.type)) continue
    const keyword = bucket.matchKeywords.find((word) => haystack.includes(normaliseMerchant(word)))
    if (!keyword) continue

    const owed = params.stillOwed(bucket.id)
    const amountFits = params.amount <= owed + Math.max(bucket.amountTolerance, Math.round(owed * 0.1))
    let inWindow = true
    if (bucket.dueWindow) {
      const window = dueWindowInCycle(bucket.dueWindow, params.cycle)
      inWindow =
        params.today >= addDays(window.start, -DUE_WINDOW_SLACK_DAYS) &&
        params.today <= addDays(window.end, DUE_WINDOW_SLACK_DAYS)
    }
    return { bucketId: bucket.id, confidence: amountFits && inWindow ? 0.95 : amountFits || inWindow ? 0.6 : 0.4 }
  }
  return null
}
