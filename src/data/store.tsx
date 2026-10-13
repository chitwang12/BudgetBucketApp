import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { dateInZone, type AllocationLine, type IsoDate, type Paise } from '../core/index.ts'
import { createDemoState, STATE_VERSION } from './mockData.ts'
import {
  addAccount,
  addManualTransaction,
  assignTransaction,
  coverOverspend,
  deleteTransaction,
  editTransaction,
  ingestSms,
  markPaid,
  moveMoney,
  recategorise,
  removeAccount,
  returnToInbox,
  setTransactionStatus,
  startCycle,
  undoMove,
  updateAccount,
  type IngestOutcome,
  type ManualTransaction,
  type NewAccount,
} from './operations.ts'
import type { Account, AppState, PlannedBucket, Settings } from './types.ts'

const STORAGE_KEY = 'bucketbudget:state'

function load(today: IsoDate): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as AppState
      if (parsed.version === STATE_VERSION) return parsed
    }
  } catch {
    // Corrupt storage falls through to fresh demo data.
  }
  return createDemoState(today)
}

function currentDate(timezone = 'Asia/Kolkata'): IsoDate {
  return dateInZone(new Date(), timezone)
}

interface Store {
  state: AppState
  today: IsoDate
  assign: (txnId: string, bucketId: string, remember: boolean) => void
  ignore: (txnId: string) => void
  markTransfer: (txnId: string) => void
  markPaid: (bucketId: string) => void
  cover: (bucketId: string) => void
  addTransaction: (input: Omit<ManualTransaction, 'occurredAt'>) => void
  confirmSalary: (income: Paise, lines: AllocationLine[]) => void
  simulateSms: (text: string) => IngestOutcome
  updateSettings: (patch: Partial<Settings>) => void
  updateBucket: (bucketId: string, patch: Partial<PlannedBucket>) => void
  recategorise: (txnId: string, bucketId: string) => void
  editTransaction: (txnId: string, patch: { amount?: Paise; merchant?: string }) => void
  returnToInbox: (txnId: string) => void
  deleteTransaction: (txnId: string) => void
  moveMoney: (fromId: string, toId: string, amount: Paise) => void
  undoMove: (moveId: string) => void
  addAccount: (input: NewAccount) => void
  updateAccount: (accountId: string, patch: Partial<Pick<Account, 'name' | 'last4' | 'active'>>) => void
  removeAccount: (accountId: string) => void
  toggleGroup: (groupId: string) => void
  resetDemo: () => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => load(currentDate()))
  const latest = useRef(state)
  const today = currentDate(state.settings.timezone)

  useEffect(() => {
    latest.current = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const update = useCallback((change: (s: AppState) => AppState) => setState((s) => change(s)), [])
  const now = () => new Date().toISOString()

  const simulateSms = useCallback(
    (text: string) => {
      const result = ingestSms(latest.current, text, new Date().toISOString(), currentDate(latest.current.settings.timezone))
      latest.current = result.state
      setState(result.state)
      return result.outcome
    },
    [],
  )

  const store = useMemo<Store>(
    () => ({
      state,
      today,
      assign: (txnId, bucketId, remember) => update((s) => assignTransaction(s, txnId, bucketId, remember)),
      ignore: (txnId) => update((s) => setTransactionStatus(s, txnId, 'ignored')),
      markTransfer: (txnId) => update((s) => setTransactionStatus(s, txnId, 'transfer')),
      markPaid: (bucketId) => update((s) => markPaid(s, bucketId, now())),
      cover: (bucketId) => update((s) => coverOverspend(s, bucketId, now())),
      addTransaction: (input) => update((s) => addManualTransaction(s, { ...input, occurredAt: now() })),
      confirmSalary: (income, lines) => update((s) => startCycle(s, today, income, lines, now())),
      simulateSms,
      updateSettings: (patch) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
      updateBucket: (bucketId, patch) =>
        update((s) => ({ ...s, buckets: s.buckets.map((b) => (b.id === bucketId ? { ...b, ...patch } : b)) })),
      recategorise: (txnId, bucketId) => update((s) => recategorise(s, txnId, bucketId)),
      editTransaction: (txnId, patch) => update((s) => editTransaction(s, txnId, patch)),
      returnToInbox: (txnId) => update((s) => returnToInbox(s, txnId)),
      deleteTransaction: (txnId) => update((s) => deleteTransaction(s, txnId)),
      moveMoney: (fromId, toId, amount) => update((s) => moveMoney(s, fromId, toId, amount, now())),
      undoMove: (moveId) => update((s) => undoMove(s, moveId)),
      addAccount: (input) => update((s) => addAccount(s, input)),
      updateAccount: (accountId, patch) => update((s) => updateAccount(s, accountId, patch)),
      removeAccount: (accountId) => update((s) => removeAccount(s, accountId)),
      toggleGroup: (groupId) =>
        update((s) => {
          const collapsed = s.ui.collapsedGroups.includes(groupId)
            ? s.ui.collapsedGroups.filter((id) => id !== groupId)
            : [...s.ui.collapsedGroups, groupId]
          return { ...s, ui: { ...s.ui, collapsedGroups: collapsed } }
        }),
      resetDemo: () => setState(createDemoState(currentDate())),
    }),
    [state, today, update, simulateSms],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside StoreProvider')
  return store
}
