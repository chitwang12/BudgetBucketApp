import { describe, expect, it } from 'vitest'
import {
  balanceOf,
  balancesByBucket,
  planCardPayment,
  planCardSwipe,
  planCommittedPayment,
  planCycleClose,
  planMove,
  planRefund,
  planSpend,
} from './ledger.ts'
import { rupees } from './money.ts'
import { examplePlan } from './testFixtures.ts'
import type { LedgerEntryDraft } from './types.ts'

describe('ledger', () => {
  it('lets a bucket go negative without borrowing', () => {
    const entries: LedgerEntryDraft[] = [
      { bucketId: 'eating_out', amount: rupees(1_500), kind: 'allocation' },
      ...planSpend('eating_out', rupees(2_100)),
    ]
    expect(balanceOf(entries, 'eating_out')).toBe(-rupees(600))
    expect(balanceOf(entries, 'buffer')).toBe(0)
  })

  it('covers an overspent bucket only when asked', () => {
    const entries = [
      { bucketId: 'eating_out', amount: -rupees(600), kind: 'spend' as const },
      { bucketId: 'buffer', amount: rupees(1_000), kind: 'allocation' as const },
      ...planMove('buffer', 'eating_out', rupees(600), 'cover'),
    ]
    const balances = balancesByBucket(entries)
    expect(balances.get('eating_out')).toBe(0)
    expect(balances.get('buffer')).toBe(rupees(400))
  })

  it('settles an EMI that cost more than expected against the buffer', () => {
    const entries = planCommittedPayment({
      bucketId: 'emi',
      amount: rupees(3_050),
      balanceBefore: rupees(3_000),
      paidBefore: 0,
      expected: rupees(3_000),
      tolerance: 0,
      bufferId: 'buffer',
    })
    const balances = balancesByBucket(entries)
    expect(balances.get('emi')).toBe(-rupees(3_000))
    expect(balances.get('buffer')).toBe(-rupees(50))
  })

  it('waits for the full amount before settling a part payment', () => {
    const first = planCommittedPayment({
      bucketId: 'family',
      amount: rupees(2_000),
      balanceBefore: rupees(5_000),
      paidBefore: 0,
      expected: rupees(5_000),
      tolerance: 0,
      bufferId: 'buffer',
    })
    expect(first).toHaveLength(1)
  })

  it('moves categorised card swipes into the card bucket and drains it on bill payment', () => {
    const swipe = planCardSwipe({ categoryBucketId: 'groceries', cardBucketId: 'card', amount: rupees(800) })
    const uncategorised = planCardSwipe({ categoryBucketId: null, cardBucketId: 'card', amount: rupees(300) })
    const payment = planCardPayment('card', rupees(800))
    const balances = balancesByBucket([...swipe, ...uncategorised, ...payment])
    expect(uncategorised).toEqual([])
    expect(balances.get('groceries')).toBe(-rupees(800))
    expect(balances.get('card')).toBe(0)
  })

  it('reverses a partial refund proportionally', () => {
    const swipe = planCardSwipe({ categoryBucketId: 'groceries', cardBucketId: 'card', amount: rupees(1_000) })
    const refund = planRefund({ originalEntries: swipe, originalAmount: rupees(1_000), refundAmount: rupees(250) })
    const balances = balancesByBucket([...swipe, ...refund])
    expect(balances.get('groceries')).toBe(-rupees(750))
    expect(balances.get('card')).toBe(rupees(750))
  })

  it('sweeps flexible leftovers and overspends into the buffer at cycle close', () => {
    const balances = new Map([
      ['groceries', rupees(300)],
      ['eating_out', -rupees(600)],
      ['fuel', 0],
      ['rent', rupees(12_000)],
      ['insurance', rupees(3_000)],
    ])
    const entries = planCycleClose({ buckets: examplePlan, balances, bufferId: 'buffer', policy: 'sweep' })
    const after = balancesByBucket([...[...balances].map(([bucketId, amount]) => ({ bucketId, amount })), ...entries])
    expect(after.get('groceries')).toBe(0)
    expect(after.get('eating_out')).toBe(0)
    expect(after.get('buffer')).toBe(-rupees(300))
    expect(after.get('rent')).toBe(rupees(12_000))
    expect(after.get('insurance')).toBe(rupees(3_000))
  })
})
