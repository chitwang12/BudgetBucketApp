import type { IsoDate } from './dates.ts'
import { sum, type Paise } from './money.ts'
import { sinkingContribution } from './sinking.ts'
import type { Bucket, LedgerEntryDraft } from './types.ts'

export interface AllocationLine {
  bucketId: string
  amount: Paise
}

export interface AllocationContext {
  cycleStart: IsoDate
  cycleStartDay: number
  balances: ReadonlyMap<string, Paise>
}

export function isCommitmentActive(bucket: Bucket): boolean {
  return bucket.instalmentsRemaining === null || bucket.instalmentsRemaining > 0
}

/** What the plan suggests putting into a non-surplus bucket this cycle. */
export function suggestedAmount(bucket: Bucket, context: AllocationContext): Paise {
  if (!isCommitmentActive(bucket)) return 0
  if (bucket.type === 'sinking' && bucket.target !== null && bucket.targetDueDate !== null) {
    return sinkingContribution({
      target: bucket.target,
      balance: context.balances.get(bucket.id) ?? 0,
      cycleStart: context.cycleStart,
      dueDate: bucket.targetDueDate,
      cycleStartDay: context.cycleStartDay,
    })
  }
  return bucket.monthlyAmount
}

/**
 * Pre-fills an allocation. Fixed buckets take their template amount (or the plan's suggestion),
 * then whatever is left is split across surplus buckets in proportion to their monthly amounts,
 * with rounding remainders going to the buffer.
 */
export function draftAllocation(
  income: Paise,
  buckets: readonly Bucket[],
  context: AllocationContext,
  template?: ReadonlyMap<string, Paise>,
): AllocationLine[] {
  const fixed = buckets
    .filter((bucket) => bucket.type !== 'surplus')
    .map((bucket) => ({
      bucketId: bucket.id,
      amount: template?.get(bucket.id) ?? suggestedAmount(bucket, context),
    }))

  const surplusBuckets = buckets.filter((bucket) => bucket.type === 'surplus')
  const leftover = Math.max(0, income - sum(fixed.map((line) => line.amount)))
  const weights = surplusBuckets.map((bucket) => template?.get(bucket.id) ?? bucket.monthlyAmount)
  const totalWeight = sum(weights)
  const buffer = surplusBuckets.find((bucket) => bucket.isBuffer)

  const surplus = surplusBuckets.map((bucket, index) => ({
    bucketId: bucket.id,
    amount:
      totalWeight > 0
        ? Math.floor((leftover * weights[index]) / totalWeight / 100) * 100
        : bucket === buffer ? leftover : 0,
  }))

  const remainder = leftover - sum(surplus.map((line) => line.amount))
  const target = surplus.find((line) => line.bucketId === buffer?.id) ?? surplus[0]
  if (target) target.amount += remainder

  return [...fixed, ...surplus]
}

export function unallocated(income: Paise, lines: readonly AllocationLine[]): Paise {
  return income - sum(lines.map((line) => line.amount))
}

/** Ledger entries for a confirmed allocation. Refuses unless every rupee has a job. */
export function confirmAllocation(income: Paise, lines: readonly AllocationLine[]): LedgerEntryDraft[] {
  if (lines.some((line) => line.amount < 0 || !Number.isInteger(line.amount))) {
    throw new Error('Allocation amounts must be whole, non-negative paise')
  }
  const left = unallocated(income, lines)
  if (left !== 0) throw new Error(`Unallocated must be ₹0 before confirming (currently ${left} paise)`)
  return lines
    .filter((line) => line.amount > 0)
    .map((line) => ({ bucketId: line.bucketId, amount: line.amount, kind: 'allocation' }))
}
