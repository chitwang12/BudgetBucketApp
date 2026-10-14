import { describe, expect, it } from 'vitest'
import { applyAll, applyCommand, type Command, type CommandBody } from '../src/data/commands.ts'
import { createDemoState, sampleMessages } from '../src/data/mockData.ts'
import type { AppState } from '../src/data/types.ts'
import { diffRows, fromRows, toRows, type DocRow } from './docs.ts'
import { isCommand, readSms, receivedTime } from './validate.ts'

const today = '2026-10-13'
const demo = createDemoState(today)

/** Stand-in for the D1 table, applying rows the way the SQL in repo.ts does. */
class Table {
  rows = new Map<string, { kind: string; id: string; pos: number; data: string }>()
  constructor(rows: DocRow[]) {
    this.write(rows, [])
  }
  write(upserts: DocRow[], deletes: { kind: string; id: string }[]) {
    for (const row of upserts) {
      const key = `${row.kind}/${row.id}`
      const old = this.rows.get(key)
      this.rows.set(key, { ...row, pos: row.pos ?? old?.pos ?? 0 })
    }
    for (const key of deletes) this.rows.delete(`${key.kind}/${key.id}`)
  }
  load() {
    return fromRows([...this.rows.values()])!
  }
}

const plain = (state: AppState) => JSON.parse(JSON.stringify({ ...state, ui: { collapsedGroups: [] } }))

let counter = 0
const command = (body: CommandBody, at = '2026-10-13T06:00:00.000Z'): Command =>
  ({ ...body, id: `cmd${String(++counter).padStart(6, '0')}`, at }) as Command

function someCommands(state: AppState): Command[] {
  const inbox = state.transactions.find((t) => t.status === 'inbox')!
  const [first, second] = state.buckets
  const sms = sampleMessages(today)
  return [
    command({ type: 'ingestSms', text: sms[0].text }, '2026-10-13T05:00:00.000Z'),
    command({ type: 'ingestSms', text: sms[3].text }, '2026-10-13T05:05:00.000Z'),
    command({ type: 'assign', txnId: inbox.id, bucketId: first.id, remember: true }),
    command({ type: 'moveMoney', fromId: first.id, toId: second.id, amount: 5000 }),
    command({ type: 'addGroup', name: 'Travel', tone: 'sky' }),
    command({
      type: 'addBucket',
      input: {
        name: 'Goa trip',
        groupId: state.groups[0].id,
        type: 'sinking',
        monthlyAmount: 200_000,
        dueWindow: null,
        target: 1_000_000,
        targetDueDate: '2027-03-01',
        matchKeywords: [],
      },
      fundFromBuffer: 20_000,
    }),
    command({ type: 'deleteTransaction', txnId: state.transactions[5].id }),
  ]
}

describe('server storage', () => {
  it('stores and reloads the whole state unchanged', () => {
    const table = new Table(toRows(demo))
    expect(plain(table.load().state)).toEqual(plain(demo))
  })

  it('writes only the rows a change touches', () => {
    const table = new Table(toRows(demo))
    const loaded = table.load()
    const [first, second] = loaded.state.buckets
    const next = applyCommand(loaded.state, command({ type: 'moveMoney', fromId: first.id, toId: second.id, amount: 100 })).state
    const { upserts, deletes } = diffRows(loaded, next)
    expect(deletes).toEqual([])
    expect(upserts.map((r) => r.kind)).toEqual(['ledger', 'ledger'])
    expect(diffRows(loaded, loaded.state)).toEqual({ upserts: [], deletes: [] })
  })

  it('ends up with the same data the phone shows after a run of changes', () => {
    const table = new Table(toRows(demo))
    const commands = someCommands(demo)
    const phone = applyAll(demo, commands)

    // The server applies them one request at a time, reloading from the table each time.
    for (const c of commands) {
      const loaded = table.load()
      const { upserts, deletes } = diffRows(loaded, applyCommand(loaded.state, c).state)
      table.write(upserts, deletes)
    }
    expect(plain(table.load().state)).toEqual(plain(phone))
  })

  it('gives the same ids on phone and server', () => {
    const c = command({ type: 'ingestSms', text: sampleMessages(today)[0].text }, '2026-10-13T05:00:00.000Z')
    const a = applyCommand(demo, c).state
    const b = applyCommand(JSON.parse(JSON.stringify(demo)), c).state
    expect(a.transactions[0].id).toBe(b.transactions[0].id)
    expect(plain(a)).toEqual(plain(b))
  })

  it('treats a command that no longer fits as a no-op', () => {
    const result = applyCommand(demo, command({ type: 'assign', txnId: 'gone', bucketId: 'gone', remember: false }))
    expect(plain(result.state)).toEqual(plain(demo))
  })
})

describe('webhook input', () => {
  const post = (body: string, type: string) => new Request('https://x/api/sms', { method: 'POST', body, headers: { 'content-type': type } })

  it('reads JSON or plain text', async () => {
    expect((await readSms(post('{"text":" Rs 10 debited "}', 'application/json'))).text).toBe('Rs 10 debited')
    expect((await readSms(post('{"message":"Rs 10 debited"}', 'text/plain'))).text).toBe('Rs 10 debited')
    expect((await readSms(post('Rs 10 debited', 'text/plain'))).text).toBe('Rs 10 debited')
    expect((await readSms(post('{broken', 'application/json'))).text).toBe('')
    expect((await readSms(post('x'.repeat(5000), 'text/plain'))).text).toBe('')
  })

  it('only trusts a believable phone timestamp', () => {
    const now = new Date('2026-10-13T06:00:00.000Z')
    expect(receivedTime('2026-10-13T05:59:00Z', now)).toBe('2026-10-13T05:59:00.000Z')
    expect(receivedTime('2030-01-01T00:00:00Z', now)).toBe(now.toISOString())
    expect(receivedTime('not a date', now)).toBe(now.toISOString())
    expect(receivedTime(null, now)).toBe(now.toISOString())
  })

  it('rejects malformed commands', () => {
    expect(isCommand({ id: 'abc123', at: '2026-10-13T06:00:00Z', type: 'ignore', txnId: 't' })).toBe(true)
    expect(isCommand({ id: 'abc123', at: '2026-10-13T06:00:00Z', type: 'dropTables' })).toBe(false)
    expect(isCommand({ id: 'a b', at: '2026-10-13T06:00:00Z', type: 'ignore' })).toBe(false)
    expect(isCommand(null)).toBe(false)
  })
})
