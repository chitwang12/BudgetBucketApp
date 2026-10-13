import type { IsoDate } from './dates.ts'
import type { Paise } from './money.ts'

export type BucketType = 'committed' | 'bill' | 'sinking' | 'flexible' | 'card' | 'surplus'

export interface DueWindow {
  startDay: number
  endDay: number
}

export interface Bucket {
  id: string
  name: string
  type: BucketType
  monthlyAmount: Paise
  dueWindow: DueWindow | null
  /** A payment within this much of the expected amount counts as fully paid. */
  amountTolerance: Paise
  /** Sinking funds only. */
  target: Paise | null
  targetDueDate: IsoDate | null
  /** Ending commitments such as a loan EMI; null means open-ended. */
  instalmentsRemaining: number | null
  isBuffer: boolean
}

export type LedgerKind =
  | 'opening'
  | 'allocation'
  | 'spend'
  | 'refund'
  | 'move'
  | 'cover'
  | 'sweep'
  | 'settlement'
  | 'card_transfer'
  | 'card_payment'

/** A ledger entry before it is written. Positive amounts add to the bucket, negative amounts take from it. */
export interface LedgerEntryDraft {
  bucketId: string
  amount: Paise
  kind: LedgerKind
  transactionId?: string
  note?: string
}
