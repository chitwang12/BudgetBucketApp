import { useState } from 'react'
import { ArrowIcon, BackIcon } from '../components/Icons.tsx'
import { Eyebrow, PageHeader, Segmented, Toggle } from '../components/ui.tsx'
import { relativeTime } from '../data/selectors.ts'
import { useStore, type SyncStatus } from '../data/store.tsx'
import { navigate } from '../lib/router.ts'

function syncLine(sync: SyncStatus): string {
  if (sync.phase === 'syncing') return 'Syncing…'
  if (sync.phase === 'error') return sync.error ?? 'Sync failed'
  if (sync.phase === 'offline') return `Offline${sync.waiting ? ` · ${sync.waiting} change${sync.waiting === 1 ? '' : 's'} waiting` : ''}`
  if (sync.waiting) return `${sync.waiting} change${sync.waiting === 1 ? '' : 's'} waiting`
  return sync.lastSyncedAt ? `Up to date · ${relativeTime(sync.lastSyncedAt)}` : 'Connected'
}

const WIPE_WORD = 'FRESH'

export function Settings({ onToast }: { onToast: (message: string) => void }) {
  const { state, updateSettings, sync, syncNow, disconnect, startFresh } = useStore()
  const { settings } = state
  const [showUrl, setShowUrl] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const webhookUrl = `${window.location.origin}/api/sms`

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      onToast('Webhook URL copied')
    } catch {
      setShowUrl(true)
    }
  }

  const leave = () => {
    const warning = sync.waiting
      ? `${sync.waiting} change${sync.waiting === 1 ? ' has' : 's have'} not reached the server yet and will be lost. Disconnect?`
      : 'Disconnect this device? Your data stays on the server; this device forgets it until you enter the key again.'
    if (window.confirm(warning)) {
      disconnect()
      onToast('Disconnected')
    }
  }

  const wipe = async () => {
    setBusy(true)
    try {
      await startFresh()
      setWiping(false)
      setTyped('')
      onToast('Fresh start · set your salary day to begin')
      navigate('/')
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <button className="back" onClick={() => navigate('/')}>
        <BackIcon /> Home
      </button>
      <PageHeader eyebrow="Just for you" title="Settings" />

      <section className="card settings-block">
        <div className="settings-row">
          <span>
            <span className="settings-row__title">Salary day</span>
            <span className="activity__meta">Cycle runs from this day to the day before</span>
          </span>
          <div className="stepper">
            <button aria-label="Earlier" onClick={() => updateSettings({ cycleStartDay: Math.max(1, settings.cycleStartDay - 1) })}>
              −
            </button>
            <span className="display display--sm">{settings.cycleStartDay}</span>
            <button aria-label="Later" onClick={() => updateSettings({ cycleStartDay: Math.min(28, settings.cycleStartDay + 1) })}>
              +
            </button>
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <span className="settings-row__title">Flexible leftovers at cycle end</span>
          <Segmented
            value={settings.leftoverPolicy}
            onChange={(leftoverPolicy) => updateSettings({ leftoverPolicy })}
            options={[
              { value: 'sweep', label: 'Sweep to buffer' },
              { value: 'rollover', label: 'Keep in bucket' },
            ]}
          />
        </div>
        <div className="settings-row">
          <Toggle
            checked={settings.aiEnabled}
            onChange={(aiEnabled) => updateSettings({ aiEnabled })}
            label={
              <span>
                <span className="settings-row__title">AI suggestions</span>
                <span className="activity__meta">Redacted merchant text only · v1.1</span>
              </span>
            }
          />
        </div>
      </section>

      <Eyebrow>Sync & backup</Eyebrow>
      <section className="card settings-block">
        <div className="settings-row">
          <span>
            <span className="settings-row__title">Your server</span>
            <span className="activity__meta">{syncLine(sync)}</span>
          </span>
          <span className={`signal${sync.phase === 'error' || sync.phase === 'offline' ? ' is-off' : ''}`}>
            <span className="signal__dot" />
            {sync.phase === 'error' ? 'Error' : sync.phase === 'offline' ? 'Offline' : 'Live'}
          </span>
        </div>
        <div className="button-row">
          <button className="button button--ghost button--small" onClick={syncNow}>
            Sync now
          </button>
          <button className="button button--ghost button--small" onClick={leave}>
            Disconnect
          </button>
        </div>
      </section>

      <Eyebrow>SMS capture</Eyebrow>
      <section className="card settings-block">
        <div className="settings-row">
          <span>
            <span className="settings-row__title">Last SMS received</span>
            <span className="activity__meta">If this goes quiet, check the Shortcut</span>
          </span>
          <span className={`signal${settings.lastSmsAt ? '' : ' is-off'}`}>
            <span className="signal__dot" />
            {settings.lastSmsAt ? relativeTime(settings.lastSmsAt) : 'never'}
          </span>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-row__title">Shortcut webhook</span>
            <span className="activity__meta mono break-all">{showUrl ? webhookUrl : webhookUrl.replace(/^https?:\/\//, '')}</span>
            <span className="activity__meta">POST with header Authorization: Bearer SMS_KEY</span>
          </span>
          <button className="button button--ghost button--small" onClick={copyUrl}>
            Copy
          </button>
        </div>
      </section>

      <Eyebrow>Money sources</Eyebrow>
      <button className="link-row card" onClick={() => navigate('/accounts')}>
        <span className="activity__main">
          <span className="activity__merchant">Accounts & cards</span>
          <span className="activity__meta">
            {state.accounts
              .filter((a) => a.active)
              .map((a) => a.name)
              .join(' · ')}
          </span>
        </span>
        <ArrowIcon />
      </button>

      <Eyebrow>Danger zone</Eyebrow>
      <section className="card settings-block">
        <div className="settings-row settings-row--stack">
          <span>
            <span className="settings-row__title">Start fresh</span>
            <span className="activity__meta">
              Deletes every transaction, balance and past month on the server and all devices. Your accounts, groups, buckets and
              merchant rules stay.
            </span>
          </span>
        </div>
        {wiping ? (
          <>
            <label className="field">
              <Eyebrow>Type {WIPE_WORD} to confirm</Eyebrow>
              <input
                className="text-input mono"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button className="button button--danger-fill button--small" disabled={typed.trim().toUpperCase() !== WIPE_WORD || busy} onClick={wipe}>
                {busy ? 'Wiping…' : 'Wipe everything'}
              </button>
              <button
                className="button button--ghost button--small"
                onClick={() => {
                  setWiping(false)
                  setTyped('')
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="button button--danger button--block" onClick={() => setWiping(true)}>
            Start fresh…
          </button>
        )}
      </section>
    </div>
  )
}
