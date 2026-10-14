import { handle, json, type Env } from '../../server/http.ts'
import { currentRev } from '../../server/repo.ts'

/** Public liveness check: says whether the database is reachable and the keys are set, never more. */
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  handle(async () => {
    const rev = await currentRev(env.DB).catch(() => null)
    return json({
      ok: rev !== null,
      database: rev === null ? 'unreachable (run the migration?)' : 'ok',
      keys: { app: (env.APP_KEY?.length ?? 0) >= 20, sms: (env.SMS_KEY?.length ?? 0) >= 20 },
    })
  })
