import { useState } from 'react'
import { Eyebrow, Sheet } from '../components/ui.tsx'
import { sampleMessages } from '../data/mockData.ts'
import { describeOutcome } from '../data/operations.ts'
import { useStore } from '../data/store.tsx'

export function SimulateSmsSheet({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (message: string) => void }) {
  const { today, simulateSms } = useStore()
  const [text, setText] = useState('')
  const samples = sampleMessages(today)

  const send = () => {
    if (!text.trim()) return
    onResult(describeOutcome(simulateSms(text.trim())))
    setText('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Simulate SMS">
      <p className="muted">
        Runs the same steps the iOS Shortcut will trigger: dedupe, parse, match commitments, apply rules, otherwise Inbox.
      </p>
      <Eyebrow>Try a sample</Eyebrow>
      <div className="chips">
        {samples.map((sample) => (
          <button key={sample.label} className="chip" onClick={() => setText(sample.text)}>
            {sample.label}
          </button>
        ))}
      </div>
      <textarea
        className="text-input sms-input"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste a bank SMS…"
      />
      <button className="button button--ink button--block" disabled={!text.trim()} onClick={send}>
        Send to app
      </button>
    </Sheet>
  )
}
