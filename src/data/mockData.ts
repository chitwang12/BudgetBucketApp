import {
  addDays,
  addMonths,
  cycleContaining,
  diffDays,
  draftAllocation,
  parseIsoDate,
  redactSms,
  rupees,
  smsFingerprint,
  type CycleBounds,
  type IsoDate,
  type Paise,
} from '../core/index.ts'
import { assignTransaction, balanceOfBucket, cardOwed, freshStart, newId, startCycle } from './operations.ts'
import type { Account, AppState, Group, LedgerEntry, PlannedBucket, Transaction } from './types.ts'

export const STATE_VERSION = 3
export const DEMO_HISTORY_CYCLES = 6
const DEMO_INCOME = rupees(50_000)

const accounts: Account[] = [
  { id: 'acc-hdfc', name: 'HDFC Savings', kind: 'bank', last4: '1234', active: true },
  { id: 'acc-sbi', name: 'SBI Salary', kind: 'bank', last4: '5678', active: true },
  { id: 'acc-card', name: 'ICICI Amazon Card', kind: 'card', last4: '9876', active: true },
  { id: 'acc-cash', name: 'Cash', kind: 'cash', last4: null, active: true },
]

const groups: Group[] = [
  { id: 'g-committed', name: 'Committed', tone: 'forest' },
  { id: 'g-bills', name: 'Bills', tone: 'teal' },
  { id: 'g-sinking', name: 'Sinking funds', tone: 'sun' },
  { id: 'g-flex', name: 'Everyday', tone: 'mango' },
  { id: 'g-card', name: 'Credit card', tone: 'blush' },
  { id: 'g-surplus', name: 'Surplus', tone: 'ink' },
]

function plannedBucket(fields: Partial<PlannedBucket> & Pick<PlannedBucket, 'id' | 'name' | 'type' | 'groupId'>): PlannedBucket {
  return {
    monthlyAmount: 0,
    dueWindow: null,
    amountTolerance: 0,
    target: null,
    targetDueDate: null,
    instalmentsRemaining: null,
    isBuffer: false,
    matchKeywords: [],
    cardAccountId: null,
    ...fields,
  }
}

interface DemoSms {
  day: number
  time: string
  amount: number
  account: string
  merchant: string
  text: string
  bucketId?: string
  suggestedBucketId?: string
  confidence?: number
  direction?: 'debit' | 'credit'
}

/** Deterministic random numbers so the demo history is the same on every reset. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Merchant = [name: string, onCard: boolean]

const MERCHANTS: Record<string, { list: Merchant[]; min: number; max: number }> = {
  groceries: { list: [['BIGBASKET', false], ['ZEPTO', true], ['BLINKIT', false], ['DMART AVENUE', true]], min: 180, max: 1_100 },
  fuel: { list: [['HPCL', false], ['SHELL INDIA', false], ['BHARAT PETROLEUM', true]], min: 400, max: 1_000 },
  eating_out: { list: [['SWIGGY', false], ['ZOMATO', false], ['BLUE TOKAI', false], ['TOIT BREWPUB', true], ['THIRD WAVE COFFEE', false]], min: 60, max: 900 },
  misc: { list: [['AMAZON PAY IN', true], ['UBER', false], ['BOOKMYSHOW', true], ['MYNTRA', true], ['APOLLO PHARMACY', false]], min: 120, max: 1_500 },
}

/** How hard each flexible bucket is pushed in each past cycle, oldest first, so trends show up in Insights. */
const INTENSITY: Record<string, number[]> = {
  groceries: [1.0, 0.92, 1.05, 1.12, 0.88, 0.97],
  fuel: [0.95, 1.1, 0.85, 1.18, 1.0, 1.04],
  eating_out: [0.9, 1.12, 1.38, 1.2, 1.52, 1.3],
  misc: [0.7, 1.4, 0.8, 0.95, 1.6, 0.9],
}

interface DemoEvent {
  offset: number
  minutes: number
  run: (state: AppState) => AppState
}

function transaction(fields: Pick<Transaction, 'accountId' | 'occurredAt' | 'amount' | 'merchant'> & Partial<Transaction>): Transaction {
  return {
    id: newId('t'),
    direction: 'debit',
    instrument: fields.accountId === 'acc-card' ? 'card' : 'upi',
    source: 'sms',
    smsRedacted: null,
    fingerprint: null,
    status: 'inbox',
    bucketId: null,
    suggestedBucketId: null,
    confidence: null,
    ...fields,
  }
}

function addAndAssign(state: AppState, txn: Transaction, bucketId: string | null): AppState {
  const next = { ...state, transactions: [txn, ...state.transactions] }
  return bucketId ? assignTransaction(next, txn.id, bucketId) : next
}

function atTime(date: IsoDate, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return new Date(`${date}T${hh}:${mm}:00+05:30`).toISOString()
}

/** One past cycle of salary, commitments, bills, card bill and everyday spending. */
function pastCycleEvents(index: number, bounds: CycleBounds): DemoEvent[] {
  const random = seededRandom(9_000 + index * 97)
  const length = diffDays(bounds.start, bounds.end) + 1
  const between = (min: number, max: number) => Math.round((min + random() * (max - min)) / 10) * 10
  const events: DemoEvent[] = []
  const pay = (day: number, amount: number, merchant: string, bucketId: string, accountId = 'acc-hdfc') => {
    const offset = Math.min(day, length - 1)
    const minutes = 9 * 60 + Math.floor(random() * 120)
    events.push({
      offset,
      minutes,
      run: (s) => addAndAssign(s, transaction({ accountId, occurredAt: atTime(addDays(bounds.start, offset), minutes), amount: rupees(amount), merchant }), bucketId),
    })
  }

  events.push({
    offset: 0,
    minutes: 9 * 60 + 12,
    run: (s) =>
      addAndAssign(
        s,
        transaction({ accountId: 'acc-sbi', occurredAt: atTime(bounds.start, 9 * 60 + 12), amount: DEMO_INCOME, merchant: 'ACME TECHNOLOGIES', direction: 'credit', instrument: 'neft', status: 'transfer' }),
        null,
      ),
  })

  if (index % 3 === 0) {
    pay(1, 3_000, 'papa.verma@okhdfcbank', 'family')
    pay(9, 2_000, 'papa.verma@okhdfcbank', 'family')
  } else {
    pay(1, 5_000, 'papa.verma@okhdfcbank', 'family')
  }
  pay(2, 5_000, 'GROWW MUTUAL FUND SIP', 'sip')
  pay(5, 999, 'AIRTEL', 'internet')
  pay(index === 3 ? 29 : 26, 12_000, 'sharma.landlord@okicici', 'rent')
  pay(28, 3_000, 'BAJAJ FINANCE EMI', 'emi')
  const electricity = between(880, 1_420)
  events.push({
    offset: 7,
    minutes: 10 * 60,
    run: (s) => ({ ...s, billed: { ...s.billed, electricity: rupees(electricity) } }),
  })
  pay(11, electricity, 'BESCOM', 'electricity')

  pay(3, 649, 'NETFLIX', 'card', 'acc-card')
  pay(8, 119, 'SPOTIFY', 'card', 'acc-card')
  pay(Math.floor(random() * 18), between(400, 1_100), 'AMAZON PAY IN', 'card', 'acc-card')

  events.push({
    offset: 20,
    minutes: 11 * 60,
    run: (s) => {
      const card = s.buckets.find((b) => b.id === 'card')!
      const owed = cardOwed(s, card)
      if (owed <= 0) return s
      const txn = transaction({ accountId: 'acc-hdfc', occurredAt: atTime(addDays(bounds.start, 20), 11 * 60), amount: owed, merchant: 'ICICI CREDIT CARD PAYMENT', instrument: 'netbanking' })
      return addAndAssign(s, txn, 'card')
    },
  })

  for (const [bucketId, { list, min, max }] of Object.entries(MERCHANTS)) {
    const plan = { groceries: 4_000, fuel: 2_000, eating_out: 1_500, misc: 1_000 }[bucketId] ?? 0
    const target = plan * (INTENSITY[bucketId]?.[index] ?? 1)
    let spent = 0
    while (spent < target) {
      const amount = Math.min(between(min, max), Math.max(min, Math.round(target - spent + 60)))
      let offset = Math.floor(random() * length)
      for (let tries = 0; tries < 3; tries++) {
        const weekday = new Date(`${addDays(bounds.start, offset)}T00:00:00Z`).getUTCDay()
        if (weekday === 0 || weekday === 5 || weekday === 6 || random() < 0.45) break
        offset = Math.floor(random() * length)
      }
      const [merchant, onCard] = list[Math.floor(random() * list.length)]
      const minutes = (bucketId === 'eating_out' ? 19 : 10) * 60 + Math.floor(random() * 180)
      const accountId = onCard ? 'acc-card' : 'acc-hdfc'
      events.push({
        offset,
        minutes,
        run: (s) => addAndAssign(s, transaction({ accountId, occurredAt: atTime(addDays(bounds.start, offset), minutes), amount: rupees(amount), merchant }), bucketId),
      })
      spent += amount
    }
  }

  return events.sort((a, b) => a.offset - b.offset || a.minutes - b.minutes)
}

/**
 * Six closed cycles of history followed by a believable day-9 snapshot of the brief's ₹50,000 plan.
 * History is generated through the same operations the app uses, so sweeps, settlements and card
 * reserves all follow the real rules. Dates are relative to today.
 */
export function createDemoState(today: IsoDate): AppState {
  let startDay = parseIsoDate(addDays(today, -8)).d
  if (startDay > 28) startDay = 28
  const current = cycleContaining(today, startDay)
  const past: CycleBounds[] = []
  let cursor = current.start
  for (let i = 0; i < DEMO_HISTORY_CYCLES; i++) {
    const bounds = cycleContaining(addDays(cursor, -1), startDay)
    past.unshift(bounds)
    cursor = bounds.start
  }

  const dateAt = (offset: number) => addDays(current.start, offset)
  const dayAt = (offset: number) => parseIsoDate(dateAt(offset)).d
  const window = (from: number, to = from) => ({ startDay: dayAt(from), endDay: dayAt(to) })
  const premiumMonth = addMonths(parseIsoDate(today).y, parseIsoDate(today).m, 7)

  const buckets: PlannedBucket[] = [
    plannedBucket({ id: 'rent', name: 'Rent', type: 'committed', groupId: 'g-committed', monthlyAmount: rupees(12_000), dueWindow: window(26, 28), matchKeywords: ['landlord', 'rent', 'sharma'] }),
    plannedBucket({ id: 'family', name: 'Family support', type: 'committed', groupId: 'g-committed', monthlyAmount: rupees(5_000), dueWindow: window(1, 12), matchKeywords: ['papa'] }),
    plannedBucket({ id: 'sip', name: 'SIP', type: 'committed', groupId: 'g-committed', monthlyAmount: rupees(5_000), dueWindow: window(2), matchKeywords: ['groww', 'sip'] }),
    plannedBucket({ id: 'emi', name: 'Bike loan EMI', type: 'committed', groupId: 'g-committed', monthlyAmount: rupees(3_000), dueWindow: window(28), matchKeywords: ['bajaj', 'emi'], instalmentsRemaining: 10 + DEMO_HISTORY_CYCLES }),
    plannedBucket({ id: 'internet', name: 'Internet', type: 'committed', groupId: 'g-committed', monthlyAmount: rupees(1_000), dueWindow: window(5), matchKeywords: ['airtel'], amountTolerance: rupees(50) }),
    plannedBucket({ id: 'electricity', name: 'Electricity', type: 'bill', groupId: 'g-bills', monthlyAmount: rupees(1_000), dueWindow: window(10, 13), matchKeywords: ['bescom', 'electricity'] }),
    plannedBucket({ id: 'insurance', name: 'Health insurance', type: 'sinking', groupId: 'g-sinking', target: rupees(18_000), targetDueDate: `${premiumMonth.y}-${String(premiumMonth.m).padStart(2, '0')}-10`, matchKeywords: ['hdfc ergo', 'insurance'] }),
    plannedBucket({ id: 'groceries', name: 'Groceries', type: 'flexible', groupId: 'g-flex', monthlyAmount: rupees(4_000) }),
    plannedBucket({ id: 'fuel', name: 'Fuel', type: 'flexible', groupId: 'g-flex', monthlyAmount: rupees(2_000) }),
    plannedBucket({ id: 'eating_out', name: 'Eating out', type: 'flexible', groupId: 'g-flex', monthlyAmount: rupees(1_500) }),
    plannedBucket({ id: 'misc', name: 'Miscellaneous', type: 'flexible', groupId: 'g-flex', monthlyAmount: rupees(1_000) }),
    plannedBucket({ id: 'card', name: 'ICICI card bill', type: 'card', groupId: 'g-card', monthlyAmount: rupees(2_000), dueWindow: window(20), cardAccountId: 'acc-card' }),
    plannedBucket({ id: 'emergency', name: 'Emergency fund', type: 'surplus', groupId: 'g-surplus', monthlyAmount: rupees(4_000) }),
    plannedBucket({ id: 'goals', name: 'Goa trip', type: 'surplus', groupId: 'g-surplus', monthlyAmount: rupees(3_000) }),
    plannedBucket({ id: 'buffer', name: 'Buffer', type: 'surplus', groupId: 'g-surplus', monthlyAmount: rupees(1_000), isBuffer: true }),
  ]

  const first = { id: 'c-h0', ...past[0], income: DEMO_INCOME }
  const startAt = atTime(first.start, 9 * 60)
  const openings: [string, Paise][] = [
    ['insurance', rupees(2_500)],
    ['emergency', rupees(18_000)],
    ['goals', rupees(0)],
    ['buffer', rupees(2_000)],
  ]
  const ledger: LedgerEntry[] = openings
    .filter(([, amount]) => amount > 0)
    .map(([bucketId, amount]) => ({
      id: newId('l'), cycleId: first.id, bucketId, amount, kind: 'opening', transactionId: null, moveId: null, note: 'Balance before the app', at: startAt,
    }))
  for (const line of draftAllocation(DEMO_INCOME, buckets, { cycleStart: first.start, cycleStartDay: startDay, balances: new Map(openings) })) {
    if (line.amount > 0) {
      ledger.push({ id: newId('l'), cycleId: first.id, bucketId: line.bucketId, amount: line.amount, kind: 'allocation', transactionId: null, moveId: null, note: null, at: startAt })
    }
  }

  let state: AppState = {
    version: STATE_VERSION,
    settings: {
      cycleStartDay: startDay,
      leftoverPolicy: 'sweep',
      aiEnabled: false,
      timezone: 'Asia/Kolkata',
      ingestToken: 'bb_demo_7f3c9a2e5d1b4f8a',
      lastSmsAt: null,
    },
    accounts,
    groups,
    buckets,
    archivedBuckets: [],
    cycle: first,
    history: [],
    ledger,
    transactions: [],
    rules: [
      { id: 'r-swiggy', pattern: 'swiggy', bucketId: 'eating_out' },
      { id: 'r-zomato', pattern: 'zomato', bucketId: 'eating_out' },
      { id: 'r-toit', pattern: 'toit', bucketId: 'eating_out' },
      { id: 'r-bluetokai', pattern: 'blue tokai', bucketId: 'eating_out' },
      { id: 'r-bigbasket', pattern: 'bigbasket', bucketId: 'groceries' },
      { id: 'r-zepto', pattern: 'zepto', bucketId: 'groceries' },
      { id: 'r-blinkit', pattern: 'blinkit', bucketId: 'groceries' },
      { id: 'r-hpcl', pattern: 'hpcl', bucketId: 'fuel' },
      { id: 'r-shell', pattern: 'shell', bucketId: 'fuel' },
    ],
    billed: {},
    ui: { collapsedGroups: [] },
  }

  for (let index = 0; index < past.length; index++) {
    for (const event of pastCycleEvents(index, past[index])) state = event.run(state)
    const nextStart = index + 1 < past.length ? past[index + 1].start : current.start
    const balances = new Map(state.buckets.map((b) => [b.id, balanceOfBucket(state, b.id)]))
    const lines = draftAllocation(DEMO_INCOME, state.buckets, { cycleStart: nextStart, cycleStartDay: startDay, balances })
    state = startCycle(state, nextStart, DEMO_INCOME, lines, atTime(nextStart, 9 * 60))
  }

  const fmt = (offset: number) => {
    const { y, m, d } = parseIsoDate(dateAt(offset))
    return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(y).slice(2)}`
  }

  const sms: DemoSms[] = [
    { day: 0, time: '09:12', amount: 50_000, account: 'acc-sbi', merchant: 'ACME TECHNOLOGIES', direction: 'credit', text: `Rs.50,000.00 credited to A/c XX5678 on ${fmt(0)} by NEFT from ACME TECHNOLOGIES. Avl Bal Rs 61,240.50` },
    { day: 1, time: '08:30', amount: 1_000, account: 'acc-hdfc', merchant: 'HPCL', bucketId: 'fuel', text: `Rs 1000.00 debited from A/c XX1234 to VPA hpcl.petrol@okaxis on ${fmt(1)}. UPI Ref 628711223344` },
    { day: 1, time: '10:05', amount: 2_000, account: 'acc-hdfc', merchant: 'papa.verma@okhdfcbank', bucketId: 'family', text: `Rs 2000.00 debited from A/c XX1234 to VPA papa.verma@okhdfcbank on ${fmt(1)}. UPI Ref 628711229911` },
    { day: 1, time: '19:40', amount: 620, account: 'acc-hdfc', merchant: 'BIGBASKET', bucketId: 'groceries', text: `Sent Rs.620.00 From HDFC Bank A/C *1234 To BIGBASKET On ${fmt(1)} Ref 628712000001` },
    { day: 2, time: '07:15', amount: 5_000, account: 'acc-hdfc', merchant: 'GROWW MUTUAL FUND SIP', bucketId: 'sip', text: `Rs.5,000.00 debited from A/c XX1234 towards GROWW MUTUAL FUND SIP on ${fmt(2)}.` },
    { day: 2, time: '21:10', amount: 810, account: 'acc-card', merchant: 'TOIT BREWPUB', bucketId: 'eating_out', text: `INR 810.00 spent using ICICI Bank Card XX9876 on ${fmt(2)} on TOIT BREWPUB. Avl Limit: INR 84,190.00` },
    { day: 5, time: '11:00', amount: 999, account: 'acc-hdfc', merchant: 'AIRTEL', bucketId: 'internet', text: `Rs 999.00 debited from A/c XX1234 to VPA airtel.broadband@icici on ${fmt(5)}. UPI Ref 628715550001` },
    { day: 5, time: '20:20', amount: 780, account: 'acc-hdfc', merchant: 'zomato@hdfcbank', bucketId: 'eating_out', text: `Rs 780.00 debited from A/c XX1234 to VPA zomato@hdfcbank on ${fmt(5)}. UPI Ref 628715550002` },
    { day: 6, time: '08:10', amount: 700, account: 'acc-hdfc', merchant: 'SHELL', bucketId: 'fuel', text: `Sent Rs.700.00 From HDFC Bank A/C *1234 To SHELL INDIA On ${fmt(6)} Ref 628716000001` },
    { day: 6, time: '13:12', amount: 1_249, account: 'acc-card', merchant: 'AMAZON PAY IN', suggestedBucketId: 'misc', confidence: 0.55, text: `INR 1,249.00 spent using ICICI Bank Card XX9876 on ${fmt(6)} on AMAZON PAY IN. Avl Limit: INR 82,941.00` },
    { day: 6, time: '18:00', amount: 280, account: 'acc-card', merchant: 'ZEPTO', bucketId: 'groceries', text: `INR 280.00 spent using ICICI Bank Card XX9876 on ${fmt(6)} on ZEPTO. Avl Limit: INR 82,661.00` },
    { day: 7, time: '16:30', amount: 280, account: 'acc-hdfc', merchant: 'paytm-4829@ybl', text: `Rs 280.00 debited from A/c XX1234 to VPA paytm-4829@ybl on ${fmt(7)}. UPI Ref 628717770001` },
    { day: 7, time: '21:45', amount: 450, account: 'acc-hdfc', merchant: 'SWIGGY', bucketId: 'eating_out', text: `Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY On ${fmt(7)} Ref 628717770002` },
    { day: 8, time: '08:05', amount: 500, account: 'acc-hdfc', merchant: 'BHARAT PETROLEUM', suggestedBucketId: 'fuel', confidence: 0.62, text: `Rs.500.00 spent on HDFC Bank Debit Card XX1234 at BHARAT PETROLEUM on ${fmt(8)}. Avl Bal Rs 18,420.00` },
    { day: 8, time: '09:20', amount: 60, account: 'acc-hdfc', merchant: 'BLUE TOKAI', bucketId: 'eating_out', text: `Sent Rs.60.00 From HDFC Bank A/C *1234 To BLUE TOKAI On ${fmt(8)} Ref 628718880001` },
  ]

  for (const item of sms) {
    const date = dateAt(item.day)
    if (date > today) continue
    const occurredAt = new Date(`${date}T${item.time}:00+05:30`).toISOString()
    const txn = transaction({
      accountId: item.account,
      occurredAt,
      amount: rupees(item.amount),
      merchant: item.merchant,
      direction: item.direction ?? 'debit',
      smsRedacted: redactSms(item.text),
      fingerprint: smsFingerprint(item.text, occurredAt),
      status: item.direction === 'credit' ? 'transfer' : 'inbox',
      suggestedBucketId: item.suggestedBucketId ?? null,
      confidence: item.confidence ?? null,
    })
    state = addAndAssign({ ...state, settings: { ...state.settings, lastSmsAt: occurredAt } }, txn, item.bucketId ?? null)
  }

  if (dateAt(7) <= today) state = { ...state, billed: { electricity: rupees(1_240) } }
  return state
}

/** The demo plan with nothing spent and no history: what a brand-new server starts with. */
export function createStarterState(today: IsoDate): AppState {
  const demo = createDemoState(today)
  return freshStart({ ...demo, settings: { ...demo.settings, lastSmsAt: null } }, today)
}

/** Bank-style messages used by the tests. */
export function sampleMessages(today: IsoDate): { label: string; text: string }[] {
  const { y, m, d } = parseIsoDate(today)
  const date = `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(y).slice(2)}`
  return [
    { label: 'Swiggy ₹349', text: `Sent Rs.349.00 From HDFC Bank A/C *1234 To SWIGGY On ${date} Ref 6287${Date.now() % 100000000}` },
    { label: 'Rent ₹12,000', text: `Rs 12000.00 debited from A/c XX1234 to VPA sharma.landlord@okicici on ${date}. UPI Ref 6287${Date.now() % 100000000}` },
    { label: 'Card · DMart', text: `INR 1,860.00 spent using ICICI Bank Card XX9876 on ${date} on DMART AVENUE. Avl Limit: INR 80,801.00` },
    { label: 'Unknown UPI', text: `Rs 150 debited from A/c XX1234 to VPA q839201@ybl on ${date}. UPI Ref 6287${Date.now() % 100000000}` },
    { label: 'Electricity bill', text: `BESCOM: Bill amount Rs 1,310.00 for your connection is due on ${date}.` },
    { label: 'OTP (ignored)', text: '482913 is your OTP for a transaction of Rs 500 at AMAZON. Do not share it with anyone.' },
  ]
}
