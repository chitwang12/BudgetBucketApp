import type { Command, CommandBody } from '../src/data/commands.ts'

const TYPES = new Set<CommandBody['type']>([
  'assign',
  'ignore',
  'markTransfer',
  'markPaid',
  'cover',
  'addTransaction',
  'confirmSalary',
  'ingestSms',
  'updateSettings',
  'updateBucket',
  'recategorise',
  'editTransaction',
  'returnToInbox',
  'deleteTransaction',
  'dismissSalary',
  'moveMoney',
  'undoMove',
  'addAccount',
  'updateAccount',
  'removeAccount',
  'addBucket',
  'removeBucket',
  'restoreBucket',
  'addGroup',
  'updateGroup',
  'moveGroup',
  'removeGroup',
])

/** Shape check only; the operations themselves ignore anything that doesn't fit the data. */
export function isCommand(value: unknown): value is Command {
  const c = value as Partial<Command> | null
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof c.id === 'string' &&
    /^[A-Za-z0-9_-]{6,40}$/.test(c.id) &&
    typeof c.at === 'string' &&
    !Number.isNaN(Date.parse(c.at)) &&
    typeof c.type === 'string' &&
    TYPES.has(c.type)
  )
}

/** Accepts what an iOS Shortcut can easily send: JSON with a text field, or the raw message as plain text. */
export async function readSms(request: Request): Promise<{ text: string; receivedAt: string | null }> {
  const type = request.headers.get('content-type') ?? ''
  const raw = await request.text()
  if (raw.length > 4000) return { text: '', receivedAt: null }
  if (type.includes('application/json') || raw.trimStart().startsWith('{')) {
    try {
      const body = JSON.parse(raw) as Record<string, unknown>
      const text = [body.text, body.message, body.body, body.sms].find((v) => typeof v === 'string') as string | undefined
      const receivedAt = typeof body.receivedAt === 'string' ? body.receivedAt : null
      return { text: (text ?? '').trim(), receivedAt }
    } catch {
      return { text: '', receivedAt: null }
    }
  }
  return { text: raw.trim(), receivedAt: null }
}

/** Uses the phone's timestamp when it is believable, otherwise the time the server received it. */
export function receivedTime(claimed: string | null, now = new Date()): string {
  if (!claimed) return now.toISOString()
  const time = Date.parse(claimed)
  const week = 7 * 24 * 60 * 60 * 1000
  if (Number.isNaN(time) || time > now.getTime() + 5 * 60 * 1000 || time < now.getTime() - week) return now.toISOString()
  return new Date(time).toISOString()
}
