import { HttpError } from './repo.ts'

export interface Env {
  DB: D1Database
  /** Full access, entered once in the app on each device. */
  APP_KEY: string
  /** Can only post SMS; this is the one the iOS Shortcut holds. */
  SMS_KEY: string
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function presentedKey(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  return request.headers.get('x-api-key')?.trim() || null
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** Compares hashes so the check takes the same time whatever the guess. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function requireKey(request: Request, expected: string | undefined): Promise<void> {
  if (!expected || expected.length < 20) throw new HttpError(500, 'Server key is not configured')
  const given = presentedKey(request)
  if (!given || !(await sameSecret(given, expected))) throw new HttpError(401, 'Wrong or missing key')
}

export function handle(run: () => Promise<Response>): Promise<Response> {
  return run().catch((error: unknown) => {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status)
    console.error(error)
    return json({ ok: false, error: 'Something went wrong on the server' }, 500)
  })
}
