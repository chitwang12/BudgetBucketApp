import { daysLeftInCycle, type CycleBounds } from './cycle.ts'
import type { IsoDate } from './dates.ts'
import { sum, type Paise } from './money.ts'

export interface SafeToSpend {
  /** Flexible money left in the cycle; overspent buckets count against it. */
  remaining: Paise
  daysLeft: number
  /** Today's allowance after what has already been spent today. Can be negative. */
  today: Paise
}

/**
 * Splits the flexible money held at the start of today evenly across the days left,
 * then subtracts today's flexible spending so the number doesn't shrink twice.
 */
export function safeToSpend(params: {
  flexibleBalances: readonly Paise[]
  spentToday: Paise
  today: IsoDate
  cycle: CycleBounds
}): SafeToSpend {
  const remaining = sum(params.flexibleBalances)
  const daysLeft = Math.max(1, daysLeftInCycle(params.today, params.cycle))
  const startOfDay = remaining + params.spentToday
  const dailyShare = startOfDay > 0 ? Math.floor(startOfDay / daysLeft) : startOfDay
  return { remaining, daysLeft, today: dailyShare - params.spentToday }
}
