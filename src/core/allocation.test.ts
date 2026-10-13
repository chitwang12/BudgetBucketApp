import { describe, expect, it } from 'vitest'
import { confirmAllocation, draftAllocation, unallocated, type AllocationContext } from './allocation.ts'
import { rupees } from './money.ts'
import { sinkingContribution } from './sinking.ts'
import { bucket, examplePlan } from './testFixtures.ts'

const context: AllocationContext = { cycleStart: '2026-11-05', cycleStartDay: 5, balances: new Map() }

describe('sinking fund', () => {
  it('sets aside a twelfth of an annual premium', () => {
    expect(
      sinkingContribution({
        target: rupees(18_000),
        balance: 0,
        cycleStart: '2026-11-05',
        dueDate: '2027-10-10',
        cycleStartDay: 5,
      }),
    ).toBe(rupees(1_500))
  })

  it('spreads what is still missing over the cycles left, rounded up to a rupee', () => {
    expect(
      sinkingContribution({
        target: rupees(18_000),
        balance: rupees(10_000),
        cycleStart: '2027-05-05',
        dueDate: '2027-10-10',
        cycleStartDay: 5,
      }),
    ).toBe(rupees(1_334))
  })

  it('stops once the target is reached', () => {
    expect(
      sinkingContribution({
        target: rupees(18_000),
        balance: rupees(18_000),
        cycleStart: '2027-05-05',
        dueDate: '2027-10-10',
        cycleStartDay: 5,
      }),
    ).toBe(0)
  })
})

describe('salary-day allocation', () => {
  it('pre-fills the example plan to exactly ₹0 unallocated', () => {
    const lines = draftAllocation(rupees(50_000), examplePlan, context)
    const amount = (id: string) => lines.find((line) => line.bucketId === id)?.amount

    expect(unallocated(rupees(50_000), lines)).toBe(0)
    expect(amount('insurance')).toBe(rupees(1_500))
    expect(amount('emergency')).toBe(rupees(4_000))
    expect(amount('goals')).toBe(rupees(3_000))
    expect(amount('buffer')).toBe(rupees(1_000))
  })

  it('splits a bigger surplus by weight and gives rounding to the buffer', () => {
    const lines = draftAllocation(rupees(50_001), examplePlan, context)
    expect(unallocated(rupees(50_001), lines)).toBe(0)
    expect(lines.find((line) => line.bucketId === 'buffer')?.amount).toBe(rupees(1_001))
  })

  it('drops a commitment whose instalments have finished', () => {
    const plan = [bucket({ id: 'emi', type: 'committed', monthlyAmount: rupees(3_000), instalmentsRemaining: 0 })]
    expect(draftAllocation(rupees(3_000), plan, context)[0].amount).toBe(0)
  })

  it('uses template amounts for one-off bonus allocations', () => {
    const plan = [
      bucket({ id: 'goals', type: 'surplus', monthlyAmount: rupees(1) }),
      bucket({ id: 'buffer', type: 'surplus', monthlyAmount: rupees(1), isBuffer: true }),
      bucket({ id: 'rent', type: 'committed', monthlyAmount: rupees(12_000) }),
    ]
    const template = new Map([
      ['rent', 0],
      ['goals', rupees(3)],
      ['buffer', rupees(1)],
    ])
    const lines = draftAllocation(rupees(20_000), plan, context, template)
    expect(lines).toEqual([
      { bucketId: 'rent', amount: 0 },
      { bucketId: 'goals', amount: rupees(15_000) },
      { bucketId: 'buffer', amount: rupees(5_000) },
    ])
  })

  it('refuses to confirm until every rupee has a job', () => {
    expect(() => confirmAllocation(rupees(100), [{ bucketId: 'a', amount: rupees(99) }])).toThrow(/₹0/)
    expect(() => confirmAllocation(rupees(100), [{ bucketId: 'a', amount: rupees(101) }])).toThrow(/₹0/)
    expect(confirmAllocation(rupees(100), [
      { bucketId: 'a', amount: rupees(100) },
      { bucketId: 'b', amount: 0 },
    ])).toEqual([{ bucketId: 'a', amount: rupees(100), kind: 'allocation' }])
  })
})
