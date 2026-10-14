import { describe, expect, it } from 'vitest'
import { draftAllocation, rupees } from '../core/index.ts'
import { createDemoState } from './mockData.ts'
import { balanceOfBucket, dismissSalary, ingestSms, pendingSalary, startCycle } from './operations.ts'
import type { AppState } from './types.ts'

const today = '2026-10-13'
const state = createDemoState(today)
let minute = 0
const receive = (s: AppState, text: string) => ingestSms(s, text, `2026-10-13T08:${String(minute++).padStart(2, '0')}:00.000Z`, today)
const newest = (s: AppState) => s.transactions[0]

describe('money coming in', () => {
  it('sends a refund from a known merchant back to its bucket', () => {
    const before = balanceOfBucket(state, 'eating_out')
    const { state: next, outcome } = receive(state, 'Rs.349.00 credited to A/c XX1234 on 13-10-26 from SWIGGY as refund. Ref 628799990001')
    expect(outcome).toMatchObject({ kind: 'applied', bucketName: 'Eating out', amount: rupees(349) })
    expect(balanceOfBucket(next, 'eating_out')).toBe(before + rupees(349))
  })

  it('returns a card refund to the spending bucket and out of the card reserve', () => {
    const merchant = newest(state).merchant
    expect(merchant).toBeTruthy()
    const before = { misc: balanceOfBucket(state, 'misc'), card: balanceOfBucket(state, 'card') }
    const { state: next, outcome } = receive(state, 'Refund of INR 1,249.00 from AMAZON PAY IN credited to ICICI Bank Card XX9876 on 13-Oct-26.')
    expect(outcome).toMatchObject({ kind: 'applied', amount: rupees(1_249) })
    const target = newest(next).bucketId!
    expect(target).not.toBe('card')
    expect(balanceOfBucket(next, 'card')).toBe(before.card - rupees(1_249))
    if (target === 'misc') expect(balanceOfBucket(next, 'misc')).toBe(before.misc + rupees(1_249))
  })

  it('treats a card bill payment received as a transfer', () => {
    const { outcome } = receive(state, 'Payment of Rs 5,000.00 received on your ICICI Bank Card XX9876. Thank you.')
    expect(outcome).toEqual({ kind: 'transfer', amount: rupees(5_000) })
  })

  it('recognises the salary and waits for salary day', () => {
    const { state: next, outcome } = receive(state, 'Rs.50,000.00 credited to A/c XX5678 on 13-10-26 by NEFT from ACME TECHNOLOGIES. Avl Bal Rs 61,240.50')
    expect(outcome).toEqual({ kind: 'salary', amount: rupees(50_000) })
    expect(pendingSalary(next)).toMatchObject({ amount: rupees(50_000), status: 'transfer' })

    const lines = draftAllocation(rupees(50_000), next.buckets, { cycleStart: today, cycleStartDay: next.settings.cycleStartDay, balances: new Map() })
    const started = startCycle(next, today, rupees(50_000), lines, '2026-10-13T09:00:00.000Z')
    expect(pendingSalary(started)).toBeUndefined()
  })

  it('sends a credit that is not salary to the Inbox on request', () => {
    const { state: next } = receive(state, 'Your salary of Rs 48,000.00 has been credited to A/c XX5678 on 13-10-26.')
    const salary = pendingSalary(next)!
    const dismissed = dismissSalary(next, salary.id)
    expect(pendingSalary(dismissed)).toBeUndefined()
    expect(dismissed.transactions.find((t) => t.id === salary.id)).toMatchObject({ status: 'inbox', suggestedBucketId: 'buffer' })
  })

  it('suggests the buffer for money received from someone unknown', () => {
    const { state: next, outcome } = receive(state, 'Rs 2,000.00 credited to A/c XX1234 on 13-10-26 from VPA rahul.k@okaxis. UPI Ref 628799990002')
    expect(outcome).toMatchObject({ kind: 'inbox', suggestion: 'Buffer' })
    expect(newest(next)).toMatchObject({ status: 'inbox', suggestedBucketId: 'buffer' })
  })

  it('pairs a transfer between two of your own accounts', () => {
    const out = receive(state, 'Rs 10,000.00 debited from A/c XX5678 on 13-10-26 trf to CHITWAN GANDHI. Ref 628799990003')
    expect(out.outcome.kind).toBe('inbox')
    const debitId = newest(out.state).id
    const back = receive(out.state, 'Rs 10,000.00 credited to A/c XX1234 on 13-10-26 from CHITWAN GANDHI. Ref 628799990004')
    expect(back.outcome).toEqual({ kind: 'transfer', amount: rupees(10_000) })
    expect(back.state.transactions.find((t) => t.id === debitId)?.status).toBe('transfer')
    expect(newest(back.state).status).toBe('transfer')
  })

  it('does not pair amounts on the same account', () => {
    const out = receive(state, 'Rs 750.00 debited from A/c XX1234 on 13-10-26 to VPA shop@ybl. Ref 628799990005')
    const back = receive(out.state, 'Rs 750.00 credited to A/c XX1234 on 13-10-26 from VPA friend@ybl. Ref 628799990006')
    expect(back.outcome.kind).toBe('inbox')
  })
})
