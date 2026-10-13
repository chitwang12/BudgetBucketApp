import type { CycleBounds } from './cycle.ts'
import { addDays, type IsoDate } from './dates.ts'
import type { Paise } from './money.ts'

export type CommittedStatus = 'reserved' | 'due_soon' | 'partial' | 'paid' | 'overdue'

export const DUE_SOON_DAYS = 3

/**
 * Status of a committed payment this cycle. `expected` should include any amount
 * carried forward as overdue from earlier cycles.
 */
export function committedStatus(params: {
  expected: Paise
  paid: Paise
  tolerance: Paise
  dueWindow: CycleBounds | null
  today: IsoDate
}): CommittedStatus {
  const { expected, paid, tolerance, dueWindow, today } = params
  if (expected > 0 && paid >= expected - tolerance) return 'paid'
  if (dueWindow && today > dueWindow.end) return 'overdue'
  if (paid > 0) return 'partial'
  if (dueWindow && today >= addDays(dueWindow.start, -DUE_SOON_DAYS)) return 'due_soon'
  return 'reserved'
}

export type BillStatus = 'expected' | 'billed' | 'paid' | 'overdue'

export function billStatus(params: {
  billed: Paise | null
  paid: Paise
  dueWindow: CycleBounds | null
  today: IsoDate
}): BillStatus {
  const { billed, paid, dueWindow, today } = params
  if (billed !== null && paid >= billed) return 'paid'
  if (dueWindow && today > dueWindow.end) return 'overdue'
  return billed !== null ? 'billed' : 'expected'
}

export type SpendingHealth = 'ok' | 'warning' | 'empty' | 'overspent'

export const WARNING_SPENT_PERCENT = 80

/** Warns once 80% of the cycle's funding is spent, red at ₹0, and overspent below ₹0. */
export function spendingHealth(balance: Paise, funded: Paise): SpendingHealth {
  if (balance < 0) return 'overspent'
  if (balance === 0) return funded > 0 ? 'empty' : 'ok'
  if (funded > 0 && (funded - balance) * 100 >= funded * WARNING_SPENT_PERCENT) return 'warning'
  return 'ok'
}

/** How much the card bill exceeds what has been reserved for it. */
export function cardGap(reserve: Paise, owed: Paise): Paise {
  return Math.max(0, owed - reserve)
}
