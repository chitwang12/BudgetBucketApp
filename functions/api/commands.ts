import { isCommand } from '../../server/validate.ts'
import { handle, json, requireKey, type Env } from '../../server/http.ts'
import { commit, HttpError } from '../../server/repo.ts'

const MAX_COMMANDS = 200

/** Changes made in the app, in order. Safe to resend: commands already applied are skipped. */
export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => {
    await requireKey(request, env.APP_KEY)
    const body = (await request.json().catch(() => null)) as { commands?: unknown } | null
    const commands = body?.commands
    if (!Array.isArray(commands) || commands.length === 0 || commands.length > MAX_COMMANDS || !commands.every(isCommand)) {
      throw new HttpError(400, 'Expected a list of commands')
    }
    const result = await commit(env.DB, commands)
    return json({ ok: true, previousRev: result.previousRev, rev: result.rev })
  })
