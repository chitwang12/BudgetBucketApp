import { describe, expect, it } from 'vitest'
import { rupees } from '../core/index.ts'
import { createDemoState, sampleMessages } from './mockData.ts'
import { assignTransaction, balanceOfBucket, coverOverspend, ingestSms, markPaid, paidThisCycle } from './operations.ts'
import { inboxItems, safeToSpendView, viewBucket } from './selectors.ts'

const today = '2026-10-13'
const now = '2026-10-13T06:00:00.000Z'

describe('demo data', () => {
  const state = createDemoState(today)
  const view = (id: string) => viewBucket(state, state.buckets.find((b) => b.id === id)!, today)

  it('opens on day 9 with the overspend, warnings and inbox the screens are designed around', () => {
    expect(state.cycle.start).toBe('2026-10-05')
    expect(balanceOfBucket(state, 'eating_out')).toBe(-rupees(600))
    expect(view('fuel').label).toBe('Low')
    expect(view('sip').label).toBe('Paid')
    expect(view('family').label).toBe('Partial')
    expect(view('internet').label).toBe('Paid')
    expect(view('electricity').label).toBe('Billed')
    expect(inboxItems(state)).toHaveLength(3)
    expect(safeToSpendView(state, today).today).toBeGreaterThan(0)
  })

  it('moves categorised card swipes into the card reserve', () => {
    const swipes = state.ledger.filter((e) => e.cycleId === state.cycle.id && e.kind === 'card_transfer')
    expect(swipes.map((e) => e.amount).sort()).toEqual([rupees(280), rupees(810)])
    expect(view('card').detail).toContain('₹2,339')
  })

  it('keeps six closed cycles of history with sensible card reserves', () => {
    expect(state.history).toHaveLength(6)
    expect(state.history.at(-1)!.end).toBe('2026-10-04')
    expect(balanceOfBucket(state, 'card')).toBeLessThan(rupees(12_000))
    expect(state.buckets.find((b) => b.id === 'emi')!.instalmentsRemaining).toBe(10)
  })

  it('covers an overspend only when asked', () => {
    const covered = coverOverspend(state, 'eating_out', now)
    expect(balanceOfBucket(covered, 'eating_out')).toBe(0)
    expect(balanceOfBucket(covered, 'buffer')).toBe(balanceOfBucket(state, 'buffer') - rupees(600))
  })

  it('marks the rest of a partial payment as paid', () => {
    const paid = markPaid(state, 'family', now)
    expect(paidThisCycle(paid, 'family')).toBe(rupees(5_000))
  })

  it('learns a rule from an inbox answer', () => {
    const paytm = inboxItems(state).find((t) => t.merchant.startsWith('paytm'))!
    const next = assignTransaction(state, paytm.id, 'misc', true)
    expect(next.rules.some((r) => r.pattern === 'paytm 4829' && r.bucketId === 'misc')).toBe(true)
  })
})

describe('simulated SMS', () => {
  const state = createDemoState(today)
  const sample = (label: string) => sampleMessages(today).find((s) => s.label.startsWith(label))!.text

  it('applies a known merchant through its rule', () => {
    const { state: next, outcome } = ingestSms(state, sample('Swiggy'), now, today)
    expect(outcome).toMatchObject({ kind: 'applied', bucketName: 'Eating out' })
    expect(balanceOfBucket(next, 'eating_out')).toBe(-rupees(949))
  })

  it('sends an early rent payment to the inbox with a suggestion', () => {
    expect(ingestSms(state, sample('Rent'), now, today).outcome).toMatchObject({ kind: 'inbox', suggestion: 'Rent' })
  })

  it('updates the electricity bill, ignores OTPs and skips duplicates', () => {
    expect(ingestSms(state, sample('Electricity'), now, today).outcome).toMatchObject({ kind: 'billed', amount: rupees(1_310) })
    expect(ingestSms(state, sample('OTP'), now, today).outcome.kind).toBe('ignored')
    const unknown = sample('Unknown')
    const first = ingestSms(state, unknown, now, today)
    expect(first.outcome.kind).toBe('inbox')
    expect(ingestSms(first.state, unknown, now, today).outcome.kind).toBe('duplicate')
  })
})
