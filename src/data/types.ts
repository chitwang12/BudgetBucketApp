import type { Bucket, Direction, Instrument, IsoDate, LedgerKind, LeftoverPolicy, Paise } from '../core/index.ts'

export type AccountKind = 'bank' | 'card' | 'cash' | 'wallet'

export interface Account {
  id: string
  name: string
  kind: AccountKind
  last4: string | null
  /** Archived accounts keep their history but disappear from pickers. */
  active: boolean
}

export interface Group {
  id: string
  name: string
  /** Accent used for the group's heading and bars. */
  tone: Tone
}

export type Tone = 'mango' | 'forest' | 'blush' | 'teal' | 'sun' | 'ink'

export interface PlannedBucket extends Bucket {
  groupId: string
  matchKeywords: string[]
  cardAccountId: string | null
}

export interface Cycle {
  id: string
  start: IsoDate
  end: IsoDate
  /** Take-home that funded the cycle. */
  income: Paise
}

export interface LedgerEntry {
  id: string
  cycleId: string
  bucketId: string
  amount: Paise
  kind: LedgerKind
  transactionId: string | null
  /** Shared by both sides of a manual move or cover, so it can be undone as one. */
  moveId: string | null
  note: string | null
  /** ISO timestamp. */
  at: string
}

export type TransactionStatus = 'applied' | 'inbox' | 'ignored' | 'transfer'

export interface Transaction {
  id: string
  accountId: string | null
  /** ISO timestamp. */
  occurredAt: string
  amount: Paise
  direction: Direction
  merchant: string
  instrument: Instrument
  source: 'sms' | 'manual'
  smsRedacted: string | null
  fingerprint: string | null
  status: TransactionStatus
  bucketId: string | null
  suggestedBucketId: string | null
  confidence: number | null
}

export interface Rule {
  id: string
  pattern: string
  bucketId: string
}

export interface Settings {
  cycleStartDay: number
  leftoverPolicy: LeftoverPolicy
  aiEnabled: boolean
  timezone: string
  ingestToken: string
  lastSmsAt: string | null
}

export interface AppState {
  version: number
  settings: Settings
  accounts: Account[]
  groups: Group[]
  buckets: PlannedBucket[]
  cycle: Cycle
  /** Closed cycles, oldest first. */
  history: Cycle[]
  ledger: LedgerEntry[]
  transactions: Transaction[]
  rules: Rule[]
  /** Latest billed amount per bill bucket for the current cycle. */
  billed: Record<string, Paise>
  ui: {
    collapsedGroups: string[]
  }
}
