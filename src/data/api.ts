import type { Command } from './commands.ts'
import type { AppState } from './types.ts'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** True when the request never reached the server (no signal, server down). */
export const isOffline = (error: unknown) => !(error instanceof ApiError)

async function call<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers },
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null
  if (!response.ok || !body?.ok) {
    if (!body) throw new TypeError(`Server unavailable (${response.status})`)
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  }
  return body
}

export type Remote = { rev: number; unchanged: true } | { rev: number; unchanged?: false; state: AppState | null }

export const fetchState = (key: string, knownRev?: number) =>
  call<Remote>(key, knownRev === undefined ? 'state' : `state?rev=${knownRev}`)

export const uploadState = (key: string, state: AppState, replace: boolean) =>
  call<{ rev: number }>(key, 'state', { method: 'PUT', body: JSON.stringify({ state, replace }) })

export const sendCommands = (key: string, commands: Command[]) =>
  call<{ previousRev: number; rev: number }>(key, 'commands', { method: 'POST', body: JSON.stringify({ commands }) })
