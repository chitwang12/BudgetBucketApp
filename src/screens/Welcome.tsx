import { useState } from 'react'
import { Eyebrow, PageHeader } from '../components/ui.tsx'
import { ApiError } from '../data/api.ts'
import { useStore } from '../data/store.tsx'
import { navigate } from '../lib/router.ts'

export function Welcome({ onToast }: { onToast: (message: string) => void }) {
  const { connect } = useStore()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await connect(key.trim())
      onToast(result === 'started' ? 'Connected · your plan is ready to edit' : 'Connected · loaded your data')
      navigate('/')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError('That key isn’t right. Use the APP_KEY you set in Cloudflare.')
      else if (e instanceof ApiError) setError(e.message)
      else setError('Can’t reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen welcome">
      <PageHeader eyebrow="Every rupee has a job" title="Bucket Budget" />
      <section className="card settings-block">
        <p className="fineprint fineprint--left">
          Your budget lives on your own server. Enter your app key once on this device to load it.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim().length >= 20 && !busy) void submit()
          }}
        >
          <label className="field">
            <Eyebrow>App key</Eyebrow>
            <input
              className="text-input mono"
              type="password"
              autoComplete="current-password"
              autoCapitalize="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste APP_KEY"
            />
          </label>
          {error && <p className="field__hint field__hint--warn">{error}</p>}
          <button type="submit" className="button button--ink button--block" disabled={key.trim().length < 20 || busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </section>
    </div>
  )
}
