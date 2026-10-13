import { useState } from 'react'
import { ArrowIcon, BackIcon } from '../components/Icons.tsx'
import { Eyebrow, PageHeader, Segmented, Toggle } from '../components/ui.tsx'
import { relativeTime } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import { navigate } from '../lib/router.ts'

export function Settings({ onSimulate, onToast }: { onSimulate: () => void; onToast: (message: string) => void }) {
  const { state, updateSettings, resetDemo } = useStore()
  const { settings } = state
  const [showToken, setShowToken] = useState(false)

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(settings.ingestToken)
      onToast('Token copied')
    } catch {
      setShowToken(true)
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

      <Eyebrow>SMS capture</Eyebrow>
      <section className="card settings-block">
        <div className="settings-row">
          <span>
            <span className="settings-row__title">Last SMS received</span>
            <span className="activity__meta">If this goes quiet, check the Shortcut</span>
          </span>
          <span className="signal">
            <span className="signal__dot" />
            {settings.lastSmsAt ? relativeTime(settings.lastSmsAt) : 'never'}
          </span>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-row__title">Shortcut token</span>
            <span className="activity__meta mono">{showToken ? settings.ingestToken : '••••••••••••' + settings.ingestToken.slice(-4)}</span>
          </span>
          <button className="button button--ghost button--small" onClick={copyToken}>
            Copy
          </button>
        </div>
        <button className="button button--accent button--block" onClick={onSimulate}>
          Simulate a bank SMS
        </button>
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

      <button
        className="button button--danger button--block"
        onClick={() => {
          if (window.confirm('Replace everything with fresh demo data?')) {
            resetDemo()
            onToast('Demo data restored')
          }
        }}
      >
        Reset demo data
      </button>
      <p className="fineprint">Demo data lives only on this device until Supabase is connected.</p>
    </div>
  )
}
