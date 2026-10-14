import { describe, expect, it } from 'vitest'
import { rupees } from '../core/index.ts'
import { applyCommand } from './commands.ts'
import { createDemoState } from './mockData.ts'
import {
  addManualTransaction,
  balanceOfBucket,
  coverOverspend,
  editTransaction,
  ingestSms,
  receivableBucket,
  recategorise,
  splitTransaction,
} from './operations.ts'
import { viewBucket } from './selectors.ts'
import type { AppState } from './types.ts'

const today = '2026-10-13'
const at = '2026-10-13T10:00:00.000Z'
const base = createDemoState(today)

function groceries(state: AppState, accountId: string | null = null) {
  const next = addManualTransaction(state, { amount: rupees(600), merchant: 'DMart', bucketId: 'groceries', accountId, direction: 'debit', occurredAt: at })
  return { state: next, txnId: next.transactions[0].id }
}

const owedBalance = (s: AppState) => balanceOfBucket(s, receivableBucket(s)!.id)

describe('splitting a bill with friends', () => {
  it('charges only my share and tracks the rest as owed', () => {
    const before = balanceOfBucket(base, 'groceries')
    const { state, txnId } = groceries(base)
    const split = splitTransaction(state, txnId, rupees(200))

    expect(balanceOfBucket(split, 'groceries')).toBe(before - rupees(200))
    expect(receivableBucket(split)).toMatchObject({ name: 'Friends owe me', type: 'surplus' })
    expect(owedBalance(split)).toBe(-rupees(400))
    expect(split.transactions.find((t) => t.id === txnId)).toMatchObject({ amount: rupees(600), myShare: rupees(200) })

    const view = viewBucket(split, receivableBucket(split)!, today)
    expect(view).toMatchObject({ overspent: false, label: 'Owed' })
  })

  it('reuses the same bucket and can be changed or removed', () => {
    const { state, txnId } = groceries(base)
    const before = balanceOfBucket(state, 'groceries') + rupees(600)
    const half = splitTransaction(splitTransaction(state, txnId, rupees(200)), txnId, rupees(300))
    expect(half.buckets.filter((b) => b.isReceivable)).toHaveLength(1)
    expect(owedBalance(half)).toBe(-rupees(300))
    expect(balanceOfBucket(half, 'groceries')).toBe(before - rupees(300))

    const whole = splitTransaction(half, txnId, rupees(600))
    expect(owedBalance(whole)).toBe(0)
    expect(balanceOfBucket(whole, 'groceries')).toBe(before - rupees(600))
    expect(whole.transactions.find((t) => t.id === txnId)?.myShare).toBeUndefined()
  })

  it('keeps the split when the transaction moves bucket or its amount is corrected', () => {
    const { state, txnId } = groceries(base)
    const split = splitTransaction(state, txnId, rupees(200))
    const moved = recategorise(split, txnId, 'eating_out')
    expect(owedBalance(moved)).toBe(-rupees(400))
    expect(balanceOfBucket(moved, 'groceries')).toBe(balanceOfBucket(base, 'groceries'))

    const corrected = editTransaction(moved, txnId, { amount: rupees(900) })
    expect(owedBalance(corrected)).toBe(-rupees(700))
    const shrunk = editTransaction(moved, txnId, { amount: rupees(150) })
    expect(owedBalance(shrunk)).toBe(0)
  })

  it('splits a card swipe: the card still reserves the full bill', () => {
    const cardBefore = balanceOfBucket(base, 'card')
    const { state, txnId } = groceries(base, 'acc-card')
    const split = splitTransaction(state, txnId, rupees(200))
    expect(balanceOfBucket(split, 'card')).toBe(cardBefore + rupees(600))
    expect(owedBalance(split)).toBe(-rupees(400))
  })

  it('suggests "Friends owe me" for money received while something is owed, without applying it', () => {
    const { state, txnId } = groceries(base)
    const split = splitTransaction(state, txnId, rupees(200))
    const { state: next, outcome } = ingestSms(split, 'Rs.400.00 credited to A/c XX1234 on 13-10-26 from VPA rahul@okaxis. Ref 628711110001', at, today)
    expect(outcome).toMatchObject({ kind: 'inbox', suggestion: 'Friends owe me' })
    expect(next.transactions[0]).toMatchObject({ status: 'inbox', suggestedBucketId: receivableBucket(next)!.id })
    expect(owedBalance(next)).toBe(-rupees(400))

    const repaid = applyCommand(next, { type: 'assign', txnId: next.transactions[0].id, bucketId: receivableBucket(next)!.id, remember: false, id: 'cmd-repay1', at }).state
    expect(owedBalance(repaid)).toBe(0)
  })

  it('suggests the buffer when nobody owes anything', () => {
    const { outcome } = ingestSms(base, 'Rs.400.00 credited to A/c XX1234 on 13-10-26 from VPA rahul@okaxis. Ref 628711110002', at, today)
    expect(outcome).toMatchObject({ kind: 'inbox', suggestion: 'Buffer' })
  })

  it('writes off what will never come back from the buffer', () => {
    const { state, txnId } = groceries(base)
    const split = splitTransaction(state, txnId, rupees(200))
    const buffer = balanceOfBucket(split, 'buffer')
    const written = coverOverspend(split, receivableBucket(split)!.id, at)
    expect(owedBalance(written)).toBe(0)
    expect(balanceOfBucket(written, 'buffer')).toBe(buffer - rupees(400))
  })

  it('produces identical ids on phone and server', () => {
    const { state, txnId } = groceries(base)
    const command = { type: 'splitTransaction' as const, txnId, myShare: rupees(200), id: 'cmd-split1', at }
    expect(applyCommand(state, command).state).toEqual(applyCommand(state, command).state)
  })
})
