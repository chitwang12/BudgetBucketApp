import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { dateInZone, type AllocationLine, type IsoDate, type Paise } from '../core/index.ts'
import { ApiError, fetchState, isOffline, sendCommands, uploadState } from './api.ts'
import { applyAll, applyCommand, makeCommandId, type Applied, type Command, type CommandBody } from './commands.ts'
import { createStarterState, STATE_VERSION } from './mockData.ts'
import { freshStart, type BucketInput, type ManualTransaction, type NewAccount } from './operations.ts'
import type { Account, AppState, Group, PlannedBucket, Settings, Tone } from './types.ts'

const STATE_KEY = 'bucketbudget:state'
const SYNC_KEY = 'bucketbudget:sync'
const UI_KEY = 'bucketbudget:ui'
const REFRESH_MS = 60_000
/** Keeps each request small enough for the free server plan. */
const BATCH = 50

interface Data {
  /** Last state confirmed by the server (or simply the saved state when not connected). */
  base: AppState
  rev: number | null
  /** Changes made on this phone that the server hasn't confirmed yet, oldest first. */
  pending: Command[]
  /** `base` with `pending` applied: what the app shows. */
  view: AppState
}

interface SavedSync {
  key: string
  rev: number
  pending: Command[]
}

function readJson<T>(key: string): T | null {
  try {
    const saved = localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : null
  } catch {
    return null
  }
}

const blank = (): Data => {
  const base = createStarterState(currentDate())
  return { base, rev: null, pending: [], view: base }
}

/** Only a connected device keeps data; anything else shows the welcome screen. */
function startup(): { data: Data; key: string | null; collapsed: string[] } {
  const sync = readJson<SavedSync>(SYNC_KEY)
  const saved = readJson<AppState>(STATE_KEY)
  const collapsed = readJson<string[]>(UI_KEY) ?? []
  if (!sync?.key || saved?.version !== STATE_VERSION) return { data: blank(), key: null, collapsed }
  return { data: { base: saved, rev: sync.rev, pending: sync.pending, view: applyAll(saved, sync.pending) }, key: sync.key, collapsed }
}

function currentDate(timezone = 'Asia/Kolkata'): IsoDate {
  return dateInZone(new Date(), timezone)
}

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  connected: boolean
  phase: SyncPhase
  error: string | null
  lastSyncedAt: string | null
  waiting: number
}

interface Store {
  state: AppState
  today: IsoDate
  sync: SyncStatus
  /** Loads the server's data, or starts it from the template when the server is empty. */
  connect: (key: string) => Promise<'started' | 'downloaded'>
  disconnect: () => void
  syncNow: () => void
  /** Wipes transactions, balances and history on the server, keeping the plan. */
  startFresh: () => Promise<void>
  assign: (txnId: string, bucketId: string, remember: boolean) => void
  ignore: (txnId: string) => void
  markTransfer: (txnId: string) => void
  markPaid: (bucketId: string, payment: { accountId: string | null; amount: Paise }) => void
  cover: (bucketId: string) => void
  addTransaction: (input: Omit<ManualTransaction, 'occurredAt'>) => void
  confirmSalary: (income: Paise, lines: AllocationLine[]) => void
  updateSettings: (patch: Partial<Settings>) => void
  updateBucket: (bucketId: string, patch: Partial<PlannedBucket>) => void
  recategorise: (txnId: string, bucketId: string) => void
  editTransaction: (txnId: string, patch: { amount?: Paise; merchant?: string }) => void
  returnToInbox: (txnId: string) => void
  deleteTransaction: (txnId: string) => void
  dismissSalary: (txnId: string) => void
  moveMoney: (fromId: string, toId: string, amount: Paise) => void
  undoMove: (moveId: string) => void
  addAccount: (input: NewAccount) => void
  updateAccount: (accountId: string, patch: Partial<Pick<Account, 'name' | 'last4' | 'active'>>) => void
  removeAccount: (accountId: string) => void
  toggleGroup: (groupId: string) => void
  addBucket: (input: BucketInput, fundFromBuffer: Paise) => void
  removeBucket: (bucketId: string) => void
  restoreBucket: (bucketId: string) => void
  addGroup: (name: string, tone: Tone) => void
  updateGroup: (groupId: string, patch: Partial<Pick<Group, 'name' | 'tone'>>) => void
  moveGroup: (groupId: string, offset: -1 | 1) => void
  removeGroup: (groupId: string) => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(startup)
  const [data, setData] = useState(initial.data)
  const [key, setKey] = useState(initial.key)
  const [collapsed, setCollapsed] = useState(initial.collapsed)
  const [status, setStatus] = useState<Omit<SyncStatus, 'connected' | 'waiting'>>({ phase: 'idle', error: null, lastSyncedAt: null })

  const dataRef = useRef(data)
  const keyRef = useRef(key)
  const busy = useRef(false)
  const again = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const save = useCallback((next: Data) => {
    dataRef.current = next
    setData(next)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(data.base))
      if (key && data.rev !== null) localStorage.setItem(SYNC_KEY, JSON.stringify({ key, rev: data.rev, pending: data.pending }))
      else localStorage.removeItem(SYNC_KEY)
    } catch {
      // Storage full or unavailable: the server copy (when connected) is still safe.
    }
  }, [data, key])

  useEffect(() => localStorage.setItem(UI_KEY, JSON.stringify(collapsed)), [collapsed])

  const runSync = useCallback(async () => {
    const syncKey = keyRef.current
    if (!syncKey) return
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    setStatus((s) => ({ ...s, phase: 'syncing' }))
    try {
      do {
        again.current = false
        const current = dataRef.current
        if (current.pending.length > 0) {
          const sent = current.pending.slice(0, BATCH)
          const result = await sendCommands(syncKey, sent)
          if (keyRef.current !== syncKey) return
          const latest = dataRef.current
          const rest = latest.pending.slice(sent.length)
          if (result.previousRev === latest.rev) {
            save({ base: applyAll(latest.base, sent), rev: result.rev, pending: rest, view: latest.view })
          } else {
            const remote = await fetchState(syncKey)
            if (keyRef.current !== syncKey) return
            if (remote.unchanged || !remote.state) throw new ApiError(409, 'The server has no data. Reconnect to upload it again.')
            save({ base: remote.state, rev: remote.rev, pending: rest, view: applyAll(remote.state, rest) })
          }
          again.current = true
          continue
        }
        const remote = await fetchState(syncKey, current.rev ?? undefined)
        if (keyRef.current !== syncKey) return
        if (!remote.unchanged) {
          if (!remote.state) throw new ApiError(409, 'The server has no data. Reconnect to upload it again.')
          const pending = dataRef.current.pending
          save({ base: remote.state, rev: remote.rev, pending, view: applyAll(remote.state, pending) })
        }
      } while (again.current)
      setStatus({ phase: 'idle', error: null, lastSyncedAt: new Date().toISOString() })
    } catch (error) {
      if (isOffline(error)) setStatus((s) => ({ ...s, phase: 'offline', error: null }))
      else
        setStatus((s) => ({
          ...s,
          phase: 'error',
          error: error instanceof ApiError && error.status === 401 ? 'The server no longer accepts this key' : (error as Error).message,
        }))
    } finally {
      busy.current = false
    }
  }, [save])

  const scheduleSync = useCallback(
    (delay = 400) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void runSync(), delay)
    },
    [runSync],
  )

  useEffect(() => {
    if (!key) return
    scheduleSync(0)
    const onVisible = () => document.visibilityState === 'visible' && scheduleSync(0)
    const onOnline = () => scheduleSync(0)
    const interval = setInterval(() => document.visibilityState === 'visible' && scheduleSync(0), REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(interval)
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [key, scheduleSync])

  const dispatch = useCallback(
    (body: CommandBody): Applied => {
      const command = { ...body, id: makeCommandId(), at: new Date().toISOString() } as Command
      const current = dataRef.current
      const applied = applyCommand(current.view, command)
      if (!keyRef.current) {
        save({ base: applied.state, rev: null, pending: [], view: applied.state })
      } else {
        save({ ...current, pending: [...current.pending, command], view: applied.state })
        scheduleSync()
      }
      return applied
    },
    [save, scheduleSync],
  )

  const connect = useCallback(
    async (newKey: string) => {
      const remote = await fetchState(newKey)
      let next: Data
      let result: 'started' | 'downloaded'
      if (!remote.unchanged && remote.state) {
        next = { base: remote.state, rev: remote.rev, pending: [], view: remote.state }
        result = 'downloaded'
      } else {
        const starter = createStarterState(currentDate())
        const { rev } = await uploadState(newKey, starter, false)
        next = { base: starter, rev, pending: [], view: starter }
        result = 'started'
      }
      keyRef.current = newKey
      setKey(newKey)
      save(next)
      setStatus({ phase: 'idle', error: null, lastSyncedAt: new Date().toISOString() })
      return result
    },
    [save],
  )

  const disconnect = useCallback(() => {
    keyRef.current = null
    setKey(null)
    save(blank())
    setStatus({ phase: 'idle', error: null, lastSyncedAt: null })
  }, [save])

  const startFresh = useCallback(async () => {
    const syncKey = keyRef.current
    if (!syncKey) return
    const current = dataRef.current
    const fresh = freshStart(current.view, currentDate(current.view.settings.timezone))
    const { rev } = await uploadState(syncKey, fresh, true)
    if (keyRef.current !== syncKey) return
    save({ base: fresh, rev, pending: [], view: fresh })
    setCollapsed([])
    setStatus({ phase: 'idle', error: null, lastSyncedAt: new Date().toISOString() })
  }, [save])

  const view = data.view
  const state = useMemo(() => ({ ...view, ui: { collapsedGroups: collapsed } }), [view, collapsed])
  const today = currentDate(view.settings.timezone)
  const sync = useMemo<SyncStatus>(() => ({ ...status, connected: key !== null, waiting: data.pending.length }), [status, key, data.pending.length])

  const store = useMemo<Store>(
    () => ({
      state,
      today,
      sync,
      connect,
      disconnect,
      startFresh,
      syncNow: () => scheduleSync(0),
      assign: (txnId, bucketId, remember) => dispatch({ type: 'assign', txnId, bucketId, remember }),
      ignore: (txnId) => dispatch({ type: 'ignore', txnId }),
      markTransfer: (txnId) => dispatch({ type: 'markTransfer', txnId }),
      markPaid: (bucketId, payment) => dispatch({ type: 'markPaid', bucketId, ...payment }),
      cover: (bucketId) => dispatch({ type: 'cover', bucketId }),
      addTransaction: (input) => dispatch({ type: 'addTransaction', input }),
      confirmSalary: (income, lines) => dispatch({ type: 'confirmSalary', salaryDate: today, income, lines }),
      updateSettings: (patch) => dispatch({ type: 'updateSettings', patch }),
      updateBucket: (bucketId, patch) => dispatch({ type: 'updateBucket', bucketId, patch }),
      recategorise: (txnId, bucketId) => dispatch({ type: 'recategorise', txnId, bucketId }),
      editTransaction: (txnId, patch) => dispatch({ type: 'editTransaction', txnId, patch }),
      returnToInbox: (txnId) => dispatch({ type: 'returnToInbox', txnId }),
      deleteTransaction: (txnId) => dispatch({ type: 'deleteTransaction', txnId }),
      dismissSalary: (txnId) => dispatch({ type: 'dismissSalary', txnId }),
      moveMoney: (fromId, toId, amount) => dispatch({ type: 'moveMoney', fromId, toId, amount }),
      undoMove: (moveId) => dispatch({ type: 'undoMove', moveId }),
      addAccount: (input) => dispatch({ type: 'addAccount', input }),
      updateAccount: (accountId, patch) => dispatch({ type: 'updateAccount', accountId, patch }),
      removeAccount: (accountId) => dispatch({ type: 'removeAccount', accountId }),
      toggleGroup: (groupId) =>
        setCollapsed((list) => (list.includes(groupId) ? list.filter((id) => id !== groupId) : [...list, groupId])),
      addBucket: (input, fundFromBuffer) => dispatch({ type: 'addBucket', input, fundFromBuffer }),
      removeBucket: (bucketId) => dispatch({ type: 'removeBucket', bucketId }),
      restoreBucket: (bucketId) => dispatch({ type: 'restoreBucket', bucketId }),
      addGroup: (name, tone) => dispatch({ type: 'addGroup', name, tone }),
      updateGroup: (groupId, patch) => dispatch({ type: 'updateGroup', groupId, patch }),
      moveGroup: (groupId, offset) => dispatch({ type: 'moveGroup', groupId, offset }),
      removeGroup: (groupId) => dispatch({ type: 'removeGroup', groupId }),
    }),
    [state, today, sync, connect, disconnect, startFresh, scheduleSync, dispatch],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside StoreProvider')
  return store
}
