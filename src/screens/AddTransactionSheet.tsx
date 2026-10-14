import { useState } from 'react'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Eyebrow, Segmented, Sheet } from '../components/ui.tsx'
import type { Direction } from '../core/index.ts'
import { useStore } from '../data/store.tsx'

export function AddTransactionSheet({ open, initialBucketId, onClose }: { open: boolean; initialBucketId: string | null; onClose: () => void }) {
  const { state, addTransaction } = useStore()
  const [amount, setAmount] = useState(0)
  const [merchant, setMerchant] = useState('')
  const [direction, setDirection] = useState<Direction>('debit')
  const [bucketId, setBucketId] = useState<string | null>(initialBucketId)
  const activeAccounts = state.accounts.filter((a) => a.active)
  const [accountId, setAccountId] = useState<string | null>(activeAccounts[0]?.id ?? null)

  const canSave = amount > 0 && bucketId !== null
  const save = () => {
    if (!canSave || !bucketId) return
    addTransaction({ amount, merchant: merchant.trim() || 'Manual entry', bucketId, accountId, direction })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add transaction">
      <MoneyInput value={amount} onChange={setAmount} size="lg" label="Amount" autoFocus />
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'debit', label: 'Spent' },
          { value: 'credit', label: 'Refund' },
        ]}
      />
      <label className="field">
        <Eyebrow>Where</Eyebrow>
        <input className="text-input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Vegetable vendor" />
      </label>

      <Eyebrow>Bucket</Eyebrow>
      <div className="chips">
        {state.buckets
          .filter((b) => b.type !== 'surplus' || b.isBuffer || b.isReceivable)
          .sort((a, b) => Number(b.type === 'flexible') - Number(a.type === 'flexible'))
          .map((b) => (
            <button
              key={b.id}
              className={`chip ${bucketId === b.id ? 'is-active' : ''}`}
              aria-pressed={bucketId === b.id}
              onClick={() => setBucketId(bucketId === b.id ? null : b.id)}
            >
              {b.name}
            </button>
          ))}
      </div>

      <Eyebrow>Paid from</Eyebrow>
      <div className="chips">
        {activeAccounts.map((a) => (
          <button
            key={a.id}
            className={`chip ${accountId === a.id ? 'is-active' : ''}`}
            aria-pressed={accountId === a.id}
            onClick={() => setAccountId(accountId === a.id ? null : a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>

      <button className="button button--ink button--block" disabled={!canSave} onClick={save}>
        Save
      </button>
    </Sheet>
  )
}
