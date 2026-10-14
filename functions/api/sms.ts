import { makeCommandId } from '../../src/data/commands.ts'
import { describeOutcome } from '../../src/data/operations.ts'
import { handle, json, requireKey, type Env } from '../../server/http.ts'
import { commit, HttpError } from '../../server/repo.ts'
import { readSms, receivedTime } from '../../server/validate.ts'

/**
 * The webhook the iOS Shortcut calls with each bank SMS:
 *   POST /api/sms   Authorization: Bearer <SMS_KEY>   {"text": "<message>"}
 * Only the redacted message is stored; the raw text is never saved.
 */
export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => {
    await requireKey(request, env.SMS_KEY)
    const { text, receivedAt } = await readSms(request)
    if (!text) throw new HttpError(400, 'Send the SMS as JSON {"text": "..."} or as plain text')
    const result = await commit(env.DB, [{ id: makeCommandId(), at: receivedTime(receivedAt), type: 'ingestSms', text }])
    const outcome = result.outcomes[0]
    return json({ ok: true, outcome: outcome?.kind ?? 'duplicate', message: outcome ? describeOutcome(outcome) : 'Already received' })
  })

export const onRequestGet: PagesFunction<Env> = () =>
  Promise.resolve(json({ ok: false, error: 'POST the SMS here with your SMS key. See README → iPhone Shortcut.' }, 405))
