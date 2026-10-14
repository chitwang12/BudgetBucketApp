import type { AppState } from '../src/data/types.ts'

/**
 * The database keeps each record as one JSON row in a `docs` table. Small lists store their array
 * position; the two long, append-only lists (ledger and transactions) store an increasing sequence
 * number, so adding one entry writes one row instead of renumbering thousands.
 */
export interface DocRow {
  kind: string
  id: string
  /** Null on an update means "keep the stored position". */
  pos: number | null
  data: string
}

export interface DocKey {
  kind: string
  id: string
}

type Meta = Pick<AppState, 'version' | 'settings' | 'cycle' | 'billed'>

const INDEXED = {
  account: (s: AppState) => s.accounts,
  group: (s: AppState) => s.groups,
  bucket: (s: AppState) => s.buckets,
  archived: (s: AppState) => s.archivedBuckets,
  history: (s: AppState) => s.history,
  rule: (s: AppState) => s.rules,
} as const

const APPENDED = {
  ledger: (s: AppState) => s.ledger,
  txn: (s: AppState) => s.transactions,
} as const

type IndexedKind = keyof typeof INDEXED
type AppendedKind = keyof typeof APPENDED

export interface Loaded {
  state: AppState
  /** Highest sequence number used per append-only list. */
  maxPos: Record<AppendedKind, number>
}

const metaOf = (s: AppState): Meta => ({ version: s.version, settings: s.settings, cycle: s.cycle, billed: s.billed })

/** Every row for a full upload. */
export function toRows(state: AppState): DocRow[] {
  const rows: DocRow[] = [{ kind: 'meta', id: 'state', pos: 0, data: JSON.stringify(metaOf(state)) }]
  for (const [kind, list] of Object.entries(INDEXED) as [IndexedKind, (s: AppState) => { id: string }[]][]) {
    list(state).forEach((item, index) => rows.push({ kind, id: item.id, pos: index, data: JSON.stringify(item) }))
  }
  state.ledger.forEach((entry, index) => rows.push({ kind: 'ledger', id: entry.id, pos: index, data: JSON.stringify(entry) }))
  // Transactions are held newest first, so the oldest gets the lowest sequence number.
  const txns = state.transactions
  txns.forEach((txn, index) => rows.push({ kind: 'txn', id: txn.id, pos: txns.length - 1 - index, data: JSON.stringify(txn) }))
  return rows
}

/** Rebuilds the app's data from stored rows. Returns null for an empty database. */
export function fromRows(rows: { kind: string; id: string; pos: number; data: string }[]): Loaded | null {
  const byKind = new Map<string, { pos: number; value: unknown }[]>()
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? []
    list.push({ pos: row.pos, value: JSON.parse(row.data) })
    byKind.set(row.kind, list)
  }
  const meta = byKind.get('meta')?.[0]?.value as Meta | undefined
  if (!meta) return null
  const sorted = <T,>(kind: string, direction: 1 | -1 = 1): T[] =>
    (byKind.get(kind) ?? []).sort((a, b) => (a.pos - b.pos) * direction).map((r) => r.value as T)
  const maxOf = (kind: string) => Math.max(-1, ...(byKind.get(kind) ?? []).map((r) => r.pos))

  return {
    state: {
      ...meta,
      accounts: sorted('account'),
      groups: sorted('group'),
      buckets: sorted('bucket'),
      archivedBuckets: sorted('archived'),
      history: sorted('history'),
      rules: sorted('rule'),
      ledger: sorted('ledger'),
      transactions: sorted('txn', -1),
      ui: { collapsedGroups: [] },
    },
    maxPos: { ledger: maxOf('ledger'), txn: maxOf('txn') },
  }
}

/**
 * The rows that differ between two states. Changes never mutate records, so an unchanged record is
 * the very same object in both states and costs nothing to compare.
 */
export function diffRows(loaded: Loaded, next: AppState): { upserts: DocRow[]; deletes: DocKey[] } {
  const prev = loaded.state
  const upserts: DocRow[] = []
  const deletes: DocKey[] = []

  const prevMeta = metaOf(prev)
  const nextMeta = metaOf(next)
  if ((Object.keys(nextMeta) as (keyof Meta)[]).some((key) => prevMeta[key] !== nextMeta[key])) {
    upserts.push({ kind: 'meta', id: 'state', pos: 0, data: JSON.stringify(nextMeta) })
  }

  for (const [kind, list] of Object.entries(INDEXED) as [IndexedKind, (s: AppState) => { id: string }[]][]) {
    const before = new Map(list(prev).map((item, index) => [item.id, { item, index }]))
    const after = list(next)
    after.forEach((item, index) => {
      const old = before.get(item.id)
      if (!old || old.item !== item || old.index !== index) upserts.push({ kind, id: item.id, pos: index, data: JSON.stringify(item) })
    })
    const kept = new Set(after.map((item) => item.id))
    for (const id of before.keys()) if (!kept.has(id)) deletes.push({ kind, id })
  }

  for (const [kind, list] of Object.entries(APPENDED) as [AppendedKind, (s: AppState) => { id: string }[]][]) {
    const before = new Map(list(prev).map((item) => [item.id, item]))
    let pos = loaded.maxPos[kind]
    const after = list(next)
    // New transactions are prepended, so walk them oldest first to keep sequence numbers in time order.
    const ordered = kind === 'txn' ? [...after].reverse() : after
    for (const item of ordered) {
      const old = before.get(item.id)
      if (!old) upserts.push({ kind, id: item.id, pos: ++pos, data: JSON.stringify(item) })
      else if (old !== item) upserts.push({ kind, id: item.id, pos: null, data: JSON.stringify(item) })
    }
    const kept = new Set(after.map((item) => item.id))
    for (const id of before.keys()) if (!kept.has(id)) deletes.push({ kind, id })
  }

  return { upserts, deletes }
}
