import type { Paise } from './money.ts'
import type { Bucket, LedgerEntryDraft } from './types.ts'

export function balanceOf(entries: readonly { bucketId: string; amount: Paise }[], bucketId: string): Paise {
  let balance = 0
  for (const entry of entries) if (entry.bucketId === bucketId) balance += entry.amount
  return balance
}

export function balancesByBucket(entries: readonly { bucketId: string; amount: Paise }[]): Map<string, Paise> {
  const balances = new Map<string, Paise>()
  for (const entry of entries) balances.set(entry.bucketId, (balances.get(entry.bucketId) ?? 0) + entry.amount)
  return balances
}

/** A plain spend from a bucket. The balance may go negative; nothing is borrowed automatically. */
export function planSpend(bucketId: string, amount: Paise, transactionId?: string): LedgerEntryDraft[] {
  return [{ bucketId, amount: -amount, kind: 'spend', transactionId }]
}

/**
 * A payment against a committed, bill or sinking bucket. Once the expected amount is reached
 * (within tolerance), whatever is left in the bucket, positive or negative, is settled to the buffer.
 */
export function planCommittedPayment(params: {
  bucketId: string
  amount: Paise
  transactionId?: string
  balanceBefore: Paise
  paidBefore: Paise
  expected: Paise
  tolerance: Paise
  bufferId: string | null
}): LedgerEntryDraft[] {
  const entries = planSpend(params.bucketId, params.amount, params.transactionId)
  const fullyPaid = params.paidBefore + params.amount >= params.expected - params.tolerance
  const residual = params.balanceBefore - params.amount
  if (fullyPaid && residual !== 0 && params.bufferId) {
    entries.push(
      { bucketId: params.bucketId, amount: -residual, kind: 'settlement', transactionId: params.transactionId },
      { bucketId: params.bufferId, amount: residual, kind: 'settlement', transactionId: params.transactionId },
    )
  }
  return entries
}

/**
 * A categorised card swipe: the category bucket pays, and the money moves into the card bucket
 * to be held for the bill. Uncategorised swipes write nothing and are covered by the card's own reserve.
 */
export function planCardSwipe(params: {
  categoryBucketId: string | null
  cardBucketId: string
  amount: Paise
  transactionId?: string
}): LedgerEntryDraft[] {
  if (!params.categoryBucketId) return []
  return [
    { bucketId: params.categoryBucketId, amount: -params.amount, kind: 'spend', transactionId: params.transactionId },
    { bucketId: params.cardBucketId, amount: params.amount, kind: 'card_transfer', transactionId: params.transactionId },
  ]
}

/** Paying the card bill drains the card bucket. The transaction itself is a transfer, not new spending. */
export function planCardPayment(cardBucketId: string, amount: Paise, transactionId?: string): LedgerEntryDraft[] {
  return [{ bucketId: cardBucketId, amount: -amount, kind: 'card_payment', transactionId }]
}

/** Reverses the original transaction's entries, scaled down for a partial refund. */
export function planRefund(params: {
  originalEntries: readonly LedgerEntryDraft[]
  originalAmount: Paise
  refundAmount: Paise
  transactionId?: string
}): LedgerEntryDraft[] {
  const ratio = Math.min(1, params.refundAmount / params.originalAmount)
  return params.originalEntries
    .map((entry) => ({
      bucketId: entry.bucketId,
      amount: -Math.round(entry.amount * ratio),
      kind: 'refund' as const,
      transactionId: params.transactionId,
    }))
    .filter((entry) => entry.amount !== 0)
}

/** Moves money between buckets, e.g. covering an overspent bucket from the buffer. */
export function planMove(
  fromBucketId: string,
  toBucketId: string,
  amount: Paise,
  kind: 'move' | 'cover' = 'move',
): LedgerEntryDraft[] {
  if (amount <= 0) throw new Error('Move amount must be positive')
  return [
    { bucketId: fromBucketId, amount: -amount, kind },
    { bucketId: toBucketId, amount, kind },
  ]
}

export type LeftoverPolicy = 'sweep' | 'rollover'

/**
 * Cycle close. With the sweep policy, every flexible bucket is reset to ₹0 against the buffer,
 * so leftovers top the buffer up and overspends draw it down. Other bucket types carry over.
 */
export function planCycleClose(params: {
  buckets: readonly Bucket[]
  balances: ReadonlyMap<string, Paise>
  bufferId: string
  policy: LeftoverPolicy
}): LedgerEntryDraft[] {
  if (params.policy === 'rollover') return []
  const entries: LedgerEntryDraft[] = []
  for (const bucket of params.buckets) {
    if (bucket.type !== 'flexible' || bucket.id === params.bufferId) continue
    const balance = params.balances.get(bucket.id) ?? 0
    if (balance === 0) continue
    entries.push(
      { bucketId: bucket.id, amount: -balance, kind: 'sweep' },
      { bucketId: params.bufferId, amount: balance, kind: 'sweep' },
    )
  }
  return entries
}
