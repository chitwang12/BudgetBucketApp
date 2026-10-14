import { handle, json, requireKey, type Env } from '../../server/http.ts'
import { currentRev, HttpError, load, replaceAll, validState } from '../../server/repo.ts'

/** The whole data set, or `unchanged` when the app already has the latest revision. */
export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => {
    await requireKey(request, env.APP_KEY)
    const known = new URL(request.url).searchParams.get('rev')
    if (known !== null) {
      const rev = await currentRev(env.DB)
      if (String(rev) === known) return json({ ok: true, rev, unchanged: true })
    }
    const { loaded, rev } = await load(env.DB)
    return json({ ok: true, rev, state: loaded?.state ?? null })
  })

/** First upload from a device, or a deliberate full replace. */
export const onRequestPut: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => {
    await requireKey(request, env.APP_KEY)
    const body = (await request.json().catch(() => null)) as { state?: unknown; replace?: boolean } | null
    if (!body || !validState(body.state)) throw new HttpError(400, 'That data does not look like this app’s data')
    const rev = await replaceAll(env.DB, body.state, body.replace === true)
    return json({ ok: true, rev })
  })
