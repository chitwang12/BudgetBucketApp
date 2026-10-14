import { dateInZone, type AllocationLine, type IsoDate, type Paise } from '../core/index.ts'
import {
  addAccount,
  addBucket,
  addGroup,
  addManualTransaction,
  assignTransaction,
  coverOverspend,
  deleteTransaction,
  editTransaction,
  ingestSms,
  markPaid,
  moveGroup,
  moveMoney,
  recategorise,
  removeAccount,
  removeBucket,
  removeGroup,
  restoreBucket,
  returnToInbox,
  setTransactionStatus,
  startCycle,
  undoMove,
  updateAccount,
  updateGroup,
  withSeededIds,
  type BucketInput,
  type IngestOutcome,
  type ManualTransaction,
  type NewAccount,
} from './operations.ts'
import type { Account, AppState, Group, PlannedBucket, Settings, Tone } from './types.ts'

/**
 * Every change to the data, as plain JSON. The phone applies a command straight away and sends it
 * to the server, which applies the same command to the stored data.
 */
export type CommandBody =
  | { type: 'assign'; txnId: string; bucketId: string; remember: boolean }
  | { type: 'ignore'; txnId: string }
  | { type: 'markTransfer'; txnId: string }
  | { type: 'markPaid'; bucketId: string; accountId: string | null; amount: Paise }
  | { type: 'cover'; bucketId: string }
  | { type: 'addTransaction'; input: Omit<ManualTransaction, 'occurredAt'> }
  | { type: 'confirmSalary'; salaryDate: IsoDate; income: Paise; lines: AllocationLine[] }
  | { type: 'ingestSms'; text: string }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'updateBucket'; bucketId: string; patch: Partial<PlannedBucket> }
  | { type: 'recategorise'; txnId: string; bucketId: string }
  | { type: 'editTransaction'; txnId: string; patch: { amount?: Paise; merchant?: string } }
  | { type: 'returnToInbox'; txnId: string }
  | { type: 'deleteTransaction'; txnId: string }
  | { type: 'moveMoney'; fromId: string; toId: string; amount: Paise }
  | { type: 'undoMove'; moveId: string }
  | { type: 'addAccount'; input: NewAccount }
  | { type: 'updateAccount'; accountId: string; patch: Partial<Pick<Account, 'name' | 'last4' | 'active'>> }
  | { type: 'removeAccount'; accountId: string }
  | { type: 'addBucket'; input: BucketInput; fundFromBuffer: Paise }
  | { type: 'removeBucket'; bucketId: string }
  | { type: 'restoreBucket'; bucketId: string }
  | { type: 'addGroup'; name: string; tone: Tone }
  | { type: 'updateGroup'; groupId: string; patch: Partial<Pick<Group, 'name' | 'tone'>> }
  | { type: 'moveGroup'; groupId: string; offset: -1 | 1 }
  | { type: 'removeGroup'; groupId: string }

/** `id` makes retries safe and seeds the ids a command creates; `at` is when it happened. */
export type Command = CommandBody & { id: string; at: string }

export function makeCommandId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replaceAll('-', '') : `${Date.now()}${Math.random()}`.replace('.', '')
  return random.slice(0, 12)
}

export interface Applied {
  state: AppState
  outcome?: IngestOutcome
}

function run(state: AppState, command: Command): Applied {
  const at = command.at
  switch (command.type) {
    case 'assign':
      return { state: assignTransaction(state, command.txnId, command.bucketId, command.remember) }
    case 'ignore':
      return { state: setTransactionStatus(state, command.txnId, 'ignored') }
    case 'markTransfer':
      return { state: setTransactionStatus(state, command.txnId, 'transfer') }
    case 'markPaid':
      return { state: markPaid(state, command.bucketId, at, { accountId: command.accountId, amount: command.amount }) }
    case 'cover':
      return { state: coverOverspend(state, command.bucketId, at) }
    case 'addTransaction':
      return { state: addManualTransaction(state, { ...command.input, occurredAt: at }) }
    case 'confirmSalary':
      return { state: startCycle(state, command.salaryDate, command.income, command.lines, at) }
    case 'ingestSms': {
      const today = dateInZone(new Date(at), state.settings.timezone)
      return ingestSms(state, command.text, at, today)
    }
    case 'updateSettings':
      return { state: { ...state, settings: { ...state.settings, ...command.patch } } }
    case 'updateBucket':
      return {
        state: { ...state, buckets: state.buckets.map((b) => (b.id === command.bucketId ? { ...b, ...command.patch, id: b.id } : b)) },
      }
    case 'recategorise':
      return { state: recategorise(state, command.txnId, command.bucketId) }
    case 'editTransaction':
      return { state: editTransaction(state, command.txnId, command.patch) }
    case 'returnToInbox':
      return { state: returnToInbox(state, command.txnId) }
    case 'deleteTransaction':
      return { state: deleteTransaction(state, command.txnId) }
    case 'moveMoney':
      return { state: moveMoney(state, command.fromId, command.toId, command.amount, at) }
    case 'undoMove':
      return { state: undoMove(state, command.moveId) }
    case 'addAccount':
      return { state: addAccount(state, command.input) }
    case 'updateAccount':
      return { state: updateAccount(state, command.accountId, command.patch) }
    case 'removeAccount':
      return { state: removeAccount(state, command.accountId) }
    case 'addBucket':
      return { state: addBucket(state, command.input, command.fundFromBuffer, at) }
    case 'removeBucket':
      return { state: removeBucket(state, command.bucketId, at) }
    case 'restoreBucket':
      return { state: restoreBucket(state, command.bucketId) }
    case 'addGroup':
      return { state: addGroup(state, command.name, command.tone) }
    case 'updateGroup':
      return { state: updateGroup(state, command.groupId, command.patch) }
    case 'moveGroup':
      return { state: moveGroup(state, command.groupId, command.offset) }
    case 'removeGroup':
      return { state: removeGroup(state, command.groupId) }
  }
}

/** Applies one command. A command that no longer fits the data (say, its transaction was deleted elsewhere) is a no-op. */
export function applyCommand(state: AppState, command: Command): Applied {
  try {
    return withSeededIds(command.id, () => run(state, command))
  } catch {
    return { state }
  }
}

export function applyAll(state: AppState, commands: Command[]): AppState {
  return commands.reduce((s, c) => applyCommand(s, c).state, state)
}
