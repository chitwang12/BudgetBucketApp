import { applyCommand, type Command } from '../src/data/commands.ts'
import { STATE_VERSION } from '../src/data/mockData.ts'
import type { IngestOutcome } from '../src/data/operations.ts'
import type { AppState } from '../src/data/types.ts'
import { diffRows, fromRows, toRows, type DocKey, type DocRow, type Loaded } from './docs.ts'

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** D1 caps a single bound value at 2 MB; stay well under it. */
const CHUNK_BYTES = 400_000

function chunks<T>(items: T[], size: (item: T) => number): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const item of items) {
    const n = size(item)
    if (current.length && bytes + n > CHUNK_BYTES) {
      out.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += n
  }
  if (current.length) out.push(current)
  return out
}

// Rows travel as one JSON parameter per statement, which keeps a save to a handful of queries.
const UPSERT_SELECT = `INSERT INTO docs (kind, id, pos, data)
  SELECT json_extract(value, '$.kind'), json_extract(value, '$.id'), coalesce(json_extract(value, '$.pos'), 0), json_extract(value, '$.data')
  FROM json_each(?1) WHERE true
  ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data`
const UPSERT_WITH_POS = `${UPSERT_SELECT}, pos = excluded.pos`

function upsertStatements(db: D1Database, rows: DocRow[]): D1PreparedStatement[] {
  const size = (r: DocRow) => r.data.length + 64
  return [
    ...chunks(
      rows.filter((r) => r.pos !== null),
      size,
    ).map((group) => db.prepare(UPSERT_WITH_POS).bind(JSON.stringify(group))),
    ...chunks(
      rows.filter((r) => r.pos === null),
      size,
    ).map((group) => db.prepare(UPSERT_SELECT).bind(JSON.stringify(group))),
  ]
}

function deleteStatements(db: D1Database, keys: DocKey[]): D1PreparedStatement[] {
  if (keys.length === 0) return []
  return chunks(keys, () => 80).map((group) =>
    db
      .prepare(`DELETE FROM docs WHERE (kind || '/' || id) IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(group.map((k) => `${k.kind}/${k.id}`))),
  )
}

export async function currentRev(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT coalesce(max(rev), 0) AS rev FROM revisions').first<{ rev: number }>()
  return row?.rev ?? 0
}

export async function load(db: D1Database): Promise<{ loaded: Loaded | null; rev: number }> {
  const [revResult, docs] = await db.batch([
    db.prepare('SELECT coalesce(max(rev), 0) AS rev FROM revisions'),
    db.prepare('SELECT kind, id, pos, data FROM docs'),
  ])
  const rev = (revResult.results[0] as { rev: number } | undefined)?.rev ?? 0
  return { loaded: fromRows(docs.results as { kind: string; id: string; pos: number; data: string }[]), rev }
}

function revisionStatement(db: D1Database, rev: number, summary: string): D1PreparedStatement {
  return db.prepare('INSERT INTO revisions (rev, at, summary) VALUES (?1, ?2, ?3)').bind(rev, new Date().toISOString(), summary)
}

const isConflict = (error: unknown) => error instanceof Error && /UNIQUE constraint failed: revisions\.rev/.test(error.message)

export function validState(state: unknown): state is AppState {
  const s = state as AppState
  return (
    typeof s === 'object' &&
    s !== null &&
    s.version === STATE_VERSION &&
    [s.accounts, s.groups, s.buckets, s.archivedBuckets, s.history, s.ledger, s.transactions, s.rules].every(Array.isArray) &&
    typeof s.settings === 'object' &&
    typeof s.cycle === 'object'
  )
}

/** First upload from a device. Refuses to overwrite existing data unless asked to. */
export async function replaceAll(db: D1Database, state: AppState, replace: boolean): Promise<number> {
  const { loaded, rev } = await load(db)
  if (loaded && !replace) throw new HttpError(409, 'The server already has data')
  const next = rev + 1
  await db.batch([
    revisionStatement(db, next, loaded ? 'replace all' : 'first upload'),
    db.prepare('DELETE FROM docs'),
    ...upsertStatements(db, toRows({ ...state, ui: { collapsedGroups: [] } })),
  ])
  return next
}

export interface CommitResult {
  /** Revision the commands were applied on top of. */
  previousRev: number
  rev: number
  state: AppState
  outcomes: (IngestOutcome | null)[]
}

/** Applies commands to the stored data and saves only what changed. Retries if another save got in first. */
export async function commit(db: D1Database, commands: Command[]): Promise<CommitResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { loaded, rev } = await load(db)
    if (!loaded) throw new HttpError(409, 'Nothing on the server yet. Connect from the app to upload your data first.')

    const ids = commands.map((c) => c.id)
    const seen = await db
      .prepare('SELECT id FROM applied WHERE id IN (SELECT value FROM json_each(?1))')
      .bind(JSON.stringify(ids))
      .all<{ id: string }>()
    const done = new Set(seen.results.map((r) => r.id))

    let state = loaded.state
    const outcomes: (IngestOutcome | null)[] = []
    const fresh: Command[] = []
    for (const command of commands) {
      if (done.has(command.id)) {
        outcomes.push(null)
        continue
      }
      const result = applyCommand(state, command)
      state = result.state
      outcomes.push(result.outcome ?? null)
      fresh.push(command)
    }
    if (fresh.length === 0) return { previousRev: rev, rev, state, outcomes }

    const { upserts, deletes } = diffRows(loaded, state)
    const next = rev + 1
    try {
      await db.batch([
        revisionStatement(db, next, fresh.map((c) => c.type).join(',')),
        db
          .prepare('INSERT INTO applied (id, rev) SELECT value, ?2 FROM json_each(?1)')
          .bind(JSON.stringify(fresh.map((c) => c.id)), next),
        ...upsertStatements(db, upserts),
        ...deleteStatements(db, deletes),
      ])
      return { previousRev: rev, rev: next, state, outcomes }
    } catch (error) {
      if (!isConflict(error)) throw error
    }
  }
  throw new HttpError(503, 'Busy, try again')
}
