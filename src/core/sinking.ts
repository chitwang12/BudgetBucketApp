import { cycleStartsUntil } from './cycle.ts'
import type { IsoDate } from './dates.ts'
import type { Paise } from './money.ts'

/**
 * Monthly contribution = (target − balance) ÷ cycles left until the due date,
 * rounded up to the next whole rupee so the target is never missed.
 */
export function sinkingContribution(params: {
  target: Paise
  balance: Paise
  cycleStart: IsoDate
  dueDate: IsoDate
  cycleStartDay: number
}): Paise {
  const remaining = params.target - params.balance
  if (remaining <= 0) return 0
  const cycles = cycleStartsUntil(params.cycleStart, params.dueDate, params.cycleStartDay)
  return Math.ceil(remaining / cycles / 100) * 100
}
