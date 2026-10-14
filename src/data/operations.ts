import {
  addDays,
  AUTO_APPLY_CONFIDENCE,
  confirmAllocation as confirmAllocationEntries,
  cycleContaining,
  cycleForSalaryDate,
  dateInZone,
  formatINR,
  matchCommitted,
  matchRule,
  normaliseMerchant,
  parseSms,
  planCardPayment,
  planCardSwipe,
  planCommittedPayment,
  planCycleClose,
  planMove,
  planSpend,
  redactSms,
  smsFingerprint,
  type AllocationLine,
  type Direction,
  type DueWindow,
  type Instrument,
  type IsoDate,
  type LedgerEntryDraft,
  type Paise,
} from '../core/index.ts'
import type { Account, AppState, Group, LedgerEntry, PlannedBucket, Tone, Transaction } from './types.ts'

let seededIds: { seed: string; next: number } | null = null

/**
 * Runs a change with ids derived from `seed`, so the phone and the server produce identical ids
 * when they apply the same command.
 */
export function withSeededIds<T>(seed: string, run: () => T): T {
  const previous = seededIds
  seededIds = { seed, next: 0 }
  try {
    return run()
  } finally {
    seededIds = previous
  }
}

/** Safari only exposes crypto.randomUUID over HTTPS, so testing on a phone over the LAN needs the fallback. */
export function newId(prefix: string): string {
  if (seededIds) return `${prefix}-${seededIds.seed}-${(seededIds.next++).toString(36)}`
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${random}`
}

export function bucketById(state: AppState, id: string): PlannedBucket {
  const bucket = findBucket(state, id)
  if (!bucket) throw new Error(`Unknown bucket ${id}`)
  return bucket
}

/** Looks in archived buckets too, for naming things in past cycles. */
export function findBucket(state: AppState, id: string | null | undefined): PlannedBucket | undefined {
  if (!id) return undefined
  return state.buckets.find((b) => b.id === id) ?? state.archivedBuckets.find((b) => b.id === id)
}

export function bufferBucket(state: AppState): PlannedBucket | undefined {
  return state.buckets.find((b) => b.isBuffer)
}

export function balanceOfBucket(state: AppState, bucketId: string): Paise {
  let total = 0
  for (const entry of state.ledger) if (entry.bucketId === bucketId) total += entry.amount
  return total
}

/** Money that has left a bucket this cycle through payments, net of refunds. */
export function paidThisCycle(state: AppState, bucketId: string): Paise {
  let paid = 0
  for (const entry of state.ledger) {
    if (entry.cycleId !== state.cycle.id || entry.bucketId !== bucketId) continue
    if (entry.kind === 'spend' || entry.kind === 'refund' || entry.kind === 'card_payment') paid -= entry.amount
  }
  return paid
}

export function expectedFor(state: AppState, bucket: PlannedBucket): Paise {
  if (bucket.type === 'bill') return state.billed[bucket.id] ?? bucket.monthlyAmount
  if (bucket.type === 'sinking') return bucket.target ?? 0
  return bucket.monthlyAmount
}

export function cardBucketForAccount(state: AppState, accountId: string | null): PlannedBucket | undefined {
  if (!accountId) return undefined
  return state.buckets.find((b) => b.type === 'card' && b.cardAccountId === accountId)
}

/** Everything spent on a card this cycle, minus bill payments made into it. */
export function cardOwed(state: AppState, card: PlannedBucket): Paise {
  let owed = 0
  for (const txn of state.transactions) {
    if (txn.accountId !== card.cardAccountId || txn.status === 'ignored') continue
    if (dateInZone(new Date(txn.occurredAt), state.settings.timezone) < state.cycle.start) continue
    owed += txn.direction === 'debit' ? txn.amount : -txn.amount
  }
  owed -= paidThisCycle(state, card.id)
  return Math.max(0, owed)
}

function entriesFor(state: AppState, txn: Transaction, bucketId: string): LedgerEntryDraft[] {
  const bucket = bucketById(state, bucketId)
  const card = cardBucketForAccount(state, txn.accountId)

  if (txn.direction === 'credit') return [{ bucketId, amount: txn.amount, kind: 'refund', transactionId: txn.id }]
  if (card && bucket.id === card.id) return []
  if (card) return planCardSwipe({ categoryBucketId: bucketId, cardBucketId: card.id, amount: txn.amount, transactionId: txn.id })
  if (bucket.type === 'card') return planCardPayment(bucket.id, txn.amount, txn.id)
  if (bucket.type === 'committed' || bucket.type === 'bill' || bucket.type === 'sinking') {
    return planCommittedPayment({
      bucketId,
      amount: txn.amount,
      transactionId: txn.id,
      balanceBefore: balanceOfBucket(state, bucketId),
      paidBefore: paidThisCycle(state, bucketId),
      expected: expectedFor(state, bucket),
      tolerance: bucket.amountTolerance,
      bufferId: bufferBucket(state)?.id ?? null,
    })
  }
  return planSpend(bucketId, txn.amount, txn.id)
}

function toLedger(
  state: AppState,
  drafts: LedgerEntryDraft[],
  at: string,
  cycleId = state.cycle.id,
  moveId: string | null = null,
): LedgerEntry[] {
  return drafts.map((draft) => ({
    id: newId('l'),
    cycleId,
    bucketId: draft.bucketId,
    amount: draft.amount,
    kind: draft.kind,
    transactionId: draft.transactionId ?? null,
    moveId,
    note: draft.note ?? null,
    at,
  }))
}

/** The cycle a moment belongs to, so corrections to older transactions stay in their own month. */
export function cycleIdFor(state: AppState, iso: string): string {
  const date = dateInZone(new Date(iso), state.settings.timezone)
  if (date >= state.cycle.start) return state.cycle.id
  const past = state.history.find((c) => date >= c.start && date <= c.end)
  return past?.id ?? state.cycle.id
}

function withTransaction(state: AppState, txn: Transaction): AppState {
  const exists = state.transactions.some((t) => t.id === txn.id)
  return {
    ...state,
    transactions: exists ? state.transactions.map((t) => (t.id === txn.id ? txn : t)) : [txn, ...state.transactions],
  }
}

export function assignTransaction(state: AppState, txnId: string, bucketId: string, remember = false): AppState {
  const txn = state.transactions.find((t) => t.id === txnId)
  if (!txn) return state
  const applied: Transaction = { ...txn, status: 'applied', bucketId }
  let next = withTransaction(state, applied)
  const entries = toLedger(next, entriesFor(state, txn, bucketId), txn.occurredAt, cycleIdFor(state, txn.occurredAt))
  next = { ...next, ledger: [...next.ledger, ...entries] }
  if (remember) {
    const pattern = normaliseMerchant(txn.merchant)
    if (pattern && !next.rules.some((r) => r.pattern === pattern)) {
      next = { ...next, rules: [...next.rules, { id: newId('r'), pattern, bucketId }] }
    }
  }
  return next
}

export function setTransactionStatus(state: AppState, txnId: string, status: 'ignored' | 'transfer'): AppState {
  return { ...state, transactions: state.transactions.map((t) => (t.id === txnId ? { ...t, status, bucketId: null } : t)) }
}

export interface ManualTransaction {
  amount: Paise
  merchant: string
  bucketId: string
  accountId: string | null
  direction: Direction
  occurredAt: string
}

export function addManualTransaction(state: AppState, input: ManualTransaction): AppState {
  const txn: Transaction = {
    id: newId('t'),
    accountId: input.accountId,
    occurredAt: input.occurredAt,
    amount: input.amount,
    direction: input.direction,
    merchant: input.merchant,
    instrument: 'other',
    source: 'manual',
    smsRedacted: null,
    fingerprint: null,
    status: 'inbox',
    bucketId: null,
    suggestedBucketId: null,
    confidence: null,
  }
  return assignTransaction(withTransaction(state, txn), txn.id, input.bucketId)
}

/** What is still owed on a committed, bill or card bucket this cycle. */
export function amountDue(state: AppState, bucket: PlannedBucket): Paise {
  return bucket.type === 'card' ? cardOwed(state, bucket) : Math.max(0, expectedFor(state, bucket) - paidThisCycle(state, bucket.id))
}

/** Accounts a bucket can be paid from. A card bill can't be paid with a credit card. */
export function paymentAccountsFor(state: AppState, bucket: PlannedBucket): Account[] {
  return state.accounts.filter((a) => a.active && !(bucket.type === 'card' && a.kind === 'card'))
}

/** Records a payment that left no SMS, such as cash to household help, for whatever is still owed. */
export function markPaid(state: AppState, bucketId: string, now: string, payment: { accountId?: string | null; amount?: Paise } = {}): AppState {
  const bucket = bucketById(state, bucketId)
  const amount = payment.amount ?? amountDue(state, bucket)
  if (amount <= 0) return state
  const fallback = bucket.type === 'card' ? null : (state.accounts.find((a) => a.kind === 'cash')?.id ?? null)
  return addManualTransaction(state, {
    amount,
    merchant: `${bucket.name} · marked paid`,
    bucketId,
    accountId: payment.accountId === undefined ? fallback : payment.accountId,
    direction: 'debit',
    occurredAt: now,
  })
}

/** Brings an overspent bucket back to ₹0 from another bucket (the buffer by default). */
export function coverOverspend(state: AppState, bucketId: string, now: string, fromId?: string): AppState {
  const source = fromId ?? bufferBucket(state)?.id
  const shortfall = -balanceOfBucket(state, bucketId)
  if (!source || shortfall <= 0) return state
  const entries = toLedger(state, planMove(source, bucketId, shortfall, 'cover'), now, state.cycle.id, newId('m'))
  return { ...state, ledger: [...state.ledger, ...entries] }
}

export function moveMoney(state: AppState, fromId: string, toId: string, amount: Paise, now: string): AppState {
  if (amount <= 0 || fromId === toId) return state
  const entries = toLedger(state, planMove(fromId, toId, amount, 'move'), now, state.cycle.id, newId('m'))
  return { ...state, ledger: [...state.ledger, ...entries] }
}

export function undoMove(state: AppState, moveId: string): AppState {
  return { ...state, ledger: state.ledger.filter((e) => e.moveId !== moveId) }
}

function withoutEntriesFor(state: AppState, txnId: string): AppState {
  return { ...state, ledger: state.ledger.filter((e) => e.transactionId !== txnId) }
}

/** Puts a transaction in a different bucket, rewriting its ledger entries as if it had been placed there first. */
export function recategorise(state: AppState, txnId: string, bucketId: string): AppState {
  const cleared = withoutEntriesFor(state, txnId)
  return assignTransaction(cleared, txnId, bucketId)
}

export function editTransaction(state: AppState, txnId: string, patch: { amount?: Paise; merchant?: string }): AppState {
  const txn = state.transactions.find((t) => t.id === txnId)
  if (!txn || (patch.amount !== undefined && patch.amount <= 0)) return state
  const updated: Transaction = { ...txn, ...patch, merchant: patch.merchant?.trim() || txn.merchant }
  const next = withTransaction(withoutEntriesFor(state, txnId), updated)
  return txn.status === 'applied' && txn.bucketId ? assignTransaction(next, txnId, txn.bucketId) : next
}

export function returnToInbox(state: AppState, txnId: string): AppState {
  const next = withoutEntriesFor(state, txnId)
  return { ...next, transactions: next.transactions.map((t) => (t.id === txnId ? { ...t, status: 'inbox', bucketId: null } : t)) }
}

/**
 * Removes a transaction and its effect on every bucket. SMS transactions are kept as ignored
 * so the same message can't be imported again.
 */
export function deleteTransaction(state: AppState, txnId: string): AppState {
  const txn = state.transactions.find((t) => t.id === txnId)
  if (!txn) return state
  const next = withoutEntriesFor(state, txnId)
  if (txn.source === 'manual') return { ...next, transactions: next.transactions.filter((t) => t.id !== txnId) }
  return { ...next, transactions: next.transactions.map((t) => (t.id === txnId ? { ...t, status: 'ignored', bucketId: null } : t)) }
}

export interface NewAccount {
  name: string
  kind: Account['kind']
  last4: string | null
  /** Cards only: monthly reserve and bill day for the card bucket that is created alongside. */
  card?: { monthlyReserve: Paise; billDay: number }
}

export function addAccount(state: AppState, input: NewAccount): AppState {
  const account: Account = { id: newId('acc'), name: input.name.trim(), kind: input.kind, last4: input.last4, active: true }
  let next: AppState = { ...state, accounts: [...state.accounts, account] }
  if (input.kind === 'card' && input.card) {
    let group = next.groups.find((g) => g.id === 'g-card') ?? next.groups.find((g) => next.buckets.some((b) => b.groupId === g.id && b.type === 'card'))
    if (!group) {
      group = { id: 'g-card', name: 'Credit card', tone: 'blush' }
      next = { ...next, groups: [...next.groups, group] }
    }
    const bucket: PlannedBucket = {
      id: newId('b'),
      name: `${account.name} bill`,
      type: 'card',
      groupId: group.id,
      monthlyAmount: input.card.monthlyReserve,
      dueWindow: { startDay: input.card.billDay, endDay: input.card.billDay },
      amountTolerance: 0,
      target: null,
      targetDueDate: null,
      instalmentsRemaining: null,
      isBuffer: false,
      matchKeywords: [],
      cardAccountId: account.id,
    }
    next = { ...next, buckets: [...next.buckets, bucket] }
  }
  return next
}

export function updateAccount(state: AppState, accountId: string, patch: Partial<Pick<Account, 'name' | 'last4' | 'active'>>): AppState {
  return { ...state, accounts: state.accounts.map((a) => (a.id === accountId ? { ...a, ...patch } : a)) }
}

export function accountInUse(state: AppState, accountId: string): boolean {
  const cardBucket = state.buckets.find((b) => b.cardAccountId === accountId)
  return (
    state.transactions.some((t) => t.accountId === accountId) ||
    (cardBucket !== undefined && state.ledger.some((e) => e.bucketId === cardBucket.id))
  )
}

/** Deletes an unused account (and its empty card bucket). Accounts with history are archived instead. */
export function removeAccount(state: AppState, accountId: string): AppState {
  if (accountInUse(state, accountId)) return updateAccount(state, accountId, { active: false })
  return {
    ...state,
    accounts: state.accounts.filter((a) => a.id !== accountId),
    buckets: state.buckets.filter((b) => b.cardAccountId !== accountId),
  }
}

export type NewBucketType = 'flexible' | 'committed' | 'bill' | 'sinking' | 'surplus'

export interface BucketInput {
  name: string
  groupId: string
  type: NewBucketType
  monthlyAmount: Paise
  dueWindow: DueWindow | null
  target: Paise | null
  targetDueDate: IsoDate | null
  matchKeywords: string[]
}

/** Adds a bucket, optionally funding it straight away from the buffer so it's usable this cycle. */
export function addBucket(state: AppState, input: BucketInput, fundFromBuffer: Paise, now: string): AppState {
  const bucket: PlannedBucket = {
    id: newId('b'),
    name: input.name.trim(),
    type: input.type,
    groupId: input.groupId,
    monthlyAmount: input.type === 'sinking' ? 0 : input.monthlyAmount,
    dueWindow: input.type === 'committed' || input.type === 'bill' ? input.dueWindow : null,
    amountTolerance: 0,
    target: input.type === 'sinking' ? input.target : null,
    targetDueDate: input.type === 'sinking' ? input.targetDueDate : null,
    instalmentsRemaining: null,
    isBuffer: false,
    matchKeywords: input.matchKeywords,
    cardAccountId: null,
  }
  const next = { ...state, buckets: [...state.buckets, bucket] }
  const buffer = bufferBucket(next)
  return buffer && fundFromBuffer > 0 ? moveMoney(next, buffer.id, bucket.id, fundFromBuffer, now) : next
}

export function bucketInUse(state: AppState, bucketId: string): boolean {
  return state.ledger.some((e) => e.bucketId === bucketId) || state.transactions.some((t) => t.bucketId === bucketId)
}

/** The buffer and card bill buckets are part of how money flows, so they can't be removed here. */
export function canRemoveBucket(bucket: PlannedBucket): boolean {
  return !bucket.isBuffer && bucket.type !== 'card'
}

/**
 * Removes a bucket from the plan. Whatever it holds (or owes) goes back to the buffer. A bucket with
 * history is archived so past cycles keep their names; an untouched one is deleted outright.
 */
export function removeBucket(state: AppState, bucketId: string, now: string): AppState {
  const bucket = state.buckets.find((b) => b.id === bucketId)
  const buffer = bufferBucket(state)
  if (!bucket || !buffer || !canRemoveBucket(bucket)) return state
  let next = state
  const balance = balanceOfBucket(state, bucketId)
  if (balance > 0) next = moveMoney(next, bucketId, buffer.id, balance, now)
  if (balance < 0) next = moveMoney(next, buffer.id, bucketId, -balance, now)
  const billed = Object.fromEntries(Object.entries(next.billed).filter(([id]) => id !== bucketId))
  next = {
    ...next,
    buckets: next.buckets.filter((b) => b.id !== bucketId),
    rules: next.rules.filter((r) => r.bucketId !== bucketId),
    transactions: next.transactions.map((t) => (t.suggestedBucketId === bucketId ? { ...t, suggestedBucketId: null, confidence: null } : t)),
    billed,
  }
  return bucketInUse(next, bucketId) ? { ...next, archivedBuckets: [...next.archivedBuckets, bucket] } : next
}

export function restoreBucket(state: AppState, bucketId: string): AppState {
  const bucket = state.archivedBuckets.find((b) => b.id === bucketId)
  if (!bucket) return state
  const groupId = state.groups.some((g) => g.id === bucket.groupId) ? bucket.groupId : state.groups[0].id
  return {
    ...state,
    buckets: [...state.buckets, { ...bucket, groupId }],
    archivedBuckets: state.archivedBuckets.filter((b) => b.id !== bucketId),
  }
}

export function addGroup(state: AppState, name: string, tone: Tone): AppState {
  return { ...state, groups: [...state.groups, { id: newId('g'), name: name.trim(), tone }] }
}

export function updateGroup(state: AppState, groupId: string, patch: Partial<Pick<Group, 'name' | 'tone'>>): AppState {
  return { ...state, groups: state.groups.map((g) => (g.id === groupId ? { ...g, ...patch, name: patch.name?.trim() || g.name } : g)) }
}

export function moveGroup(state: AppState, groupId: string, offset: -1 | 1): AppState {
  const index = state.groups.findIndex((g) => g.id === groupId)
  const target = index + offset
  if (index < 0 || target < 0 || target >= state.groups.length) return state
  const groups = [...state.groups]
  ;[groups[index], groups[target]] = [groups[target], groups[index]]
  return { ...state, groups }
}

/** Only empty groups can go, so no bucket is ever left without a home. */
export function removeGroup(state: AppState, groupId: string): AppState {
  if (state.buckets.some((b) => b.groupId === groupId) || state.groups.length <= 1) return state
  return { ...state, groups: state.groups.filter((g) => g.id !== groupId) }
}

/** Closes the current cycle (sweeping leftovers) and opens a new one funded by the confirmed allocation. */
export function startCycle(state: AppState, salaryDate: IsoDate, income: Paise, lines: AllocationLine[], now: string): AppState {
  const allocationEntries = confirmAllocationEntries(income, lines)
  const buffer = bufferBucket(state)
  let ledger = state.ledger
  if (buffer) {
    const balances = new Map(state.buckets.map((b) => [b.id, balanceOfBucket(state, b.id)]))
    const sweep = planCycleClose({ buckets: state.buckets, balances, bufferId: buffer.id, policy: state.settings.leftoverPolicy })
    ledger = [...ledger, ...toLedger(state, sweep, now)]
  }
  const bounds = cycleForSalaryDate(salaryDate, state.settings.cycleStartDay)
  const cycle = { id: newId('c'), ...bounds, income }
  const closed = { ...state.cycle, end: bounds.start > state.cycle.start ? addDays(bounds.start, -1) : state.cycle.end }
  // The placeholder cycle after a fresh start isn't a real month unless money moved in it.
  const placeholder = state.cycle.income === 0 && !ledger.some((e) => e.cycleId === state.cycle.id)
  const allocated = new Set(allocationEntries.map((e) => e.bucketId))
  const buckets = state.buckets.map((b) =>
    b.type === 'committed' && b.instalmentsRemaining !== null && allocated.has(b.id)
      ? { ...b, instalmentsRemaining: Math.max(0, b.instalmentsRemaining - 1) }
      : b,
  )
  const history = placeholder ? state.history : [...state.history, closed]
  const next: AppState = { ...state, buckets, cycle, history, billed: {} }
  return { ...next, ledger: [...ledger, ...toLedger(next, allocationEntries, now, cycle.id)] }
}

/**
 * Keeps the plan (accounts, groups, buckets, merchant rules and settings) and clears everything that
 * happened: transactions, balances and past cycles. The current cycle waits for the first salary day.
 */
export function freshStart(state: AppState, today: IsoDate): AppState {
  const bucketIds = new Set(state.buckets.map((b) => b.id))
  return {
    ...state,
    archivedBuckets: [],
    cycle: { id: newId('c'), ...cycleContaining(today, state.settings.cycleStartDay), income: 0 },
    history: [],
    ledger: [],
    transactions: [],
    rules: state.rules.filter((r) => bucketIds.has(r.bucketId)),
    billed: {},
    ui: { collapsedGroups: [] },
  }
}

export type IngestOutcome =
  | { kind: 'duplicate' }
  | { kind: 'ignored'; reason: string }
  | { kind: 'billed'; bucketName: string; amount: Paise }
  | { kind: 'applied'; bucketName: string; amount: Paise; merchant: string }
  | { kind: 'transfer'; amount: Paise }
  | { kind: 'inbox'; amount: Paise; merchant: string; suggestion: string | null }

export function describeOutcome(outcome: IngestOutcome): string {
  switch (outcome.kind) {
    case 'duplicate':
      return 'Duplicate message, skipped'
    case 'ignored':
      return `Ignored: ${outcome.reason}`
    case 'billed':
      return `${outcome.bucketName} bill updated to ${formatINR(outcome.amount)}`
    case 'applied':
      return `${formatINR(outcome.amount)} ${outcome.merchant} → ${outcome.bucketName}`
    case 'transfer':
      return `${formatINR(outcome.amount)} recorded as a transfer`
    case 'inbox':
      return `${formatINR(outcome.amount)} ${outcome.merchant} sent to Inbox${outcome.suggestion ? ` (maybe ${outcome.suggestion})` : ''}`
  }
}

const CARD_BILL_PAYMENT = /\b(credit card|cc payment|card bill|card payment)\b/i

/** The same steps the server will run: dedupe, parse, then committed match, card payment, rules, inbox. */
export function ingestSms(
  state: AppState,
  text: string,
  receivedAt: string,
  today: IsoDate,
): { state: AppState; outcome: IngestOutcome } {
  const fingerprint = smsFingerprint(text, receivedAt)
  if (state.transactions.some((t) => t.fingerprint === fingerprint)) return { state, outcome: { kind: 'duplicate' } }

  let next: AppState = { ...state, settings: { ...state.settings, lastSmsAt: receivedAt } }
  const parsed = parseSms(text)
  if (parsed.kind === 'ignore') return { state: next, outcome: { kind: 'ignored', reason: parsed.reason } }

  if (parsed.kind === 'bill') {
    const haystack = normaliseMerchant(text)
    const bill = next.buckets.find((b) => b.type === 'bill' && b.matchKeywords.some((k) => haystack.includes(normaliseMerchant(k))))
    if (!bill) return { state: next, outcome: { kind: 'ignored', reason: 'Bill for an unknown biller' } }
    next = { ...next, billed: { ...next.billed, [bill.id]: parsed.amount } }
    return { state: next, outcome: { kind: 'billed', bucketName: bill.name, amount: parsed.amount } }
  }

  const account = parsed.last4 ? next.accounts.find((a) => a.last4 === parsed.last4) : undefined
  const merchant = parsed.merchantRaw ?? 'Unknown'
  const txn: Transaction = {
    id: newId('t'),
    accountId: account?.id ?? null,
    occurredAt: receivedAt,
    amount: parsed.amount,
    direction: parsed.direction,
    merchant,
    instrument: parsed.instrument as Instrument,
    source: 'sms',
    smsRedacted: redactSms(text),
    fingerprint,
    status: 'inbox',
    bucketId: null,
    suggestedBucketId: null,
    confidence: null,
  }
  next = withTransaction(next, txn)

  const isCardAccount = account?.kind === 'card'
  if (parsed.direction === 'credit' && isCardAccount) {
    return { state: setTransactionStatus(next, txn.id, 'transfer'), outcome: { kind: 'transfer', amount: txn.amount } }
  }
  if (parsed.direction === 'debit' && !isCardAccount && CARD_BILL_PAYMENT.test(text)) {
    const card = next.buckets.find((b) => b.type === 'card')
    if (card) {
      next = assignTransaction(next, txn.id, card.id)
      return { state: setTransactionStatus(next, txn.id, 'transfer'), outcome: { kind: 'transfer', amount: txn.amount } }
    }
  }

  if (parsed.direction === 'debit') {
    const committed = matchCommitted({
      buckets: next.buckets,
      text,
      amount: txn.amount,
      today,
      cycle: next.cycle,
      stillOwed: (id) => Math.max(0, expectedFor(next, bucketById(next, id)) - paidThisCycle(next, id)),
    })
    if (committed && committed.confidence >= AUTO_APPLY_CONFIDENCE) {
      next = assignTransaction(next, txn.id, committed.bucketId)
      return { state: next, outcome: { kind: 'applied', bucketName: bucketById(next, committed.bucketId).name, amount: txn.amount, merchant } }
    }
    const rule = matchRule(next.rules, merchant)
    if (rule) {
      next = assignTransaction(next, txn.id, rule.bucketId)
      return { state: next, outcome: { kind: 'applied', bucketName: bucketById(next, rule.bucketId).name, amount: txn.amount, merchant } }
    }
    if (committed) {
      next = withTransaction(next, { ...txn, suggestedBucketId: committed.bucketId, confidence: committed.confidence })
      return { state: next, outcome: { kind: 'inbox', amount: txn.amount, merchant, suggestion: bucketById(next, committed.bucketId).name } }
    }
  }
  return { state: next, outcome: { kind: 'inbox', amount: txn.amount, merchant, suggestion: null } }
}
