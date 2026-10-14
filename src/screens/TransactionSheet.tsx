import { useState } from 'react'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Eyebrow, Money, Pill, Sheet } from '../components/ui.tsx'
import { formatINR, type Paise } from '../core/index.ts'
import { findBucket } from '../data/operations.ts'
import { relativeTime } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import { useSheets } from '../lib/sheets.tsx'

const timeFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** Everything you can correct about one transaction: bucket, amount, name, or remove it entirely. */
export function TransactionSheet({ txnId, onClose }: { txnId: string; onClose: () => void }) {
  const { state, recategorise, editTransaction, returnToInbox, deleteTransaction, splitTransaction } = useStore()
  const { toast } = useSheets()
  const txn = state.transactions.find((t) => t.id === txnId)
  const [editing, setEditing] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [share, setShare] = useState(txn?.myShare ?? Math.round((txn?.amount ?? 0) / 2))
  const [amount, setAmount] = useState(txn?.amount ?? 0)
  const [merchant, setMerchant] = useState(txn?.merchant ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [targetId, setTargetId] = useState<string | null>(null)
  if (!txn) return null

  const account = state.accounts.find((a) => a.id === txn.accountId)
  const bucket = findBucket(state, txn.bucketId)
  const isCardAccount = account?.kind === 'card'
  const choices = state.buckets.filter((b) => b.type !== 'surplus' || b.isBuffer || b.isReceivable)
  const canSplit = txn.direction === 'debit' && txn.status === 'applied' && !!bucket && bucket.type !== 'card' && !bucket.isReceivable
  const presets = [
    { label: 'Half', value: Math.round(txn.amount / 2) },
    { label: 'A third', value: Math.round(txn.amount / 3) },
    { label: 'A quarter', value: Math.round(txn.amount / 4) },
  ]
  const saveSplit = (myShare: Paise) => {
    splitTransaction(txn.id, myShare)
    toast(myShare < txn.amount ? `${formatINR(txn.amount - myShare)} added to Friends owe me` : 'Split removed')
    setSplitting(false)
  }
  const status =
    txn.status === 'applied' ? (bucket?.name ?? 'Applied') : txn.status === 'inbox' ? 'In Inbox' : txn.status === 'transfer' ? 'Transfer' : 'Ignored'

  const target = state.buckets.find((b) => b.id === targetId && b.id !== txn.bucketId)
  const transfer = () => {
    if (!target) return
    recategorise(txn.id, target.id)
    toast(`Transferred to ${target.name}`)
    setTargetId(null)
  }

  const saveEdit = () => {
    editTransaction(txn.id, { amount, merchant })
    setEditing(false)
    toast('Transaction updated')
  }

  return (
    <Sheet open onClose={onClose} title={txn.merchant}>
      <div className="detail-hero">
        <Eyebrow>
          {account ? `${account.name}${account.last4 ? ` ••${account.last4}` : ''}` : 'Manual'} · {timeFormat.format(new Date(txn.occurredAt))}
        </Eyebrow>
        <Money value={txn.direction === 'debit' ? -txn.amount : txn.amount} className="detail-hero__number detail-hero__number--plain" />
        <div className="detail-hero__row">
          <Pill mood={txn.status === 'applied' ? 'good' : txn.status === 'inbox' ? 'warn' : 'calm'}>{status}</Pill>
          <span className="muted">
            {txn.source === 'sms' ? 'From bank SMS' : 'Added by hand'} · {relativeTime(txn.occurredAt)}
          </span>
        </div>
        {txn.myShare !== undefined && (
          <p className="muted">
            Split · your share {formatINR(txn.myShare)}, friends owe {formatINR(txn.amount - txn.myShare)}
          </p>
        )}
      </div>

      {txn.smsRedacted && <p className="sms">{txn.smsRedacted}</p>}

      {txn.status !== 'transfer' && (
        <>
          <Eyebrow>{txn.status === 'applied' ? 'Move to another bucket' : 'Put in a bucket'}</Eyebrow>
          {isCardAccount && <p className="muted">Card spend: the category pays and the money is held in the card reserve.</p>}
          <div className="chips">
            {choices.map((b) => {
              const isCurrent = b.id === txn.bucketId
              const isPicked = b.id === targetId
              return (
                <button
                  key={b.id}
                  className={`chip ${isPicked ? 'is-active' : isCurrent ? 'is-current' : ''}`}
                  aria-pressed={isPicked}
                  disabled={isCurrent}
                  onClick={() => setTargetId(isPicked ? null : b.id)}
                >
                  {b.name}
                  {isCurrent ? ' · now' : ''}
                </button>
              )
            })}
          </div>
          {target && (
            <button className="button button--ink button--block" onClick={transfer}>
              Transfer to {target.name}
            </button>
          )}
        </>
      )}

      {splitting ? (
        <div className="card edit-card">
          <Eyebrow>Your share of {formatINR(txn.amount)}</Eyebrow>
          <div className="chips">
            {presets.map((p) => (
              <button key={p.label} className={`chip ${share === p.value ? 'is-active' : ''}`} aria-pressed={share === p.value} onClick={() => setShare(p.value)}>
                {p.label} · {formatINR(p.value)}
              </button>
            ))}
          </div>
          <MoneyInput value={share} onChange={setShare} size="lg" label="Your share" />
          <p className="muted">
            {share < txn.amount
              ? `${bucket?.name ?? 'Its bucket'} pays ${formatINR(share)}. Friends owe you ${formatINR(txn.amount - share)} until they pay you back.`
              : 'Your share can’t be more than the total.'}
          </p>
          <div className="button-row">
            <button className="button button--ink" disabled={share >= txn.amount} onClick={() => saveSplit(share)}>
              Split
            </button>
            {txn.myShare !== undefined && (
              <button className="button button--ghost" onClick={() => saveSplit(txn.amount)}>
                Remove split
              </button>
            )}
            <button className="button button--ghost" onClick={() => setSplitting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="card edit-card">
          <Eyebrow>Correct the amount</Eyebrow>
          <MoneyInput value={amount} onChange={setAmount} size="lg" label="Amount" />
          <label className="field">
            <Eyebrow>Name</Eyebrow>
            <input className="text-input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </label>
          <div className="button-row">
            <button className="button button--ink" disabled={amount <= 0} onClick={saveEdit}>
              Save
            </button>
            <button className="button button--ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="action-list card list">
          {canSplit && (
            <button className="action" onClick={() => setSplitting(true)}>
              <span>{txn.myShare !== undefined ? 'Change split' : 'Split with friends'}</span>
              <span className="action__hint">
                {txn.myShare !== undefined ? `Your share ${formatINR(txn.myShare)}` : 'Only your share counts as spending'}
              </span>
            </button>
          )}
          <button className="action" onClick={() => setEditing(true)}>
            <span>Edit amount or name</span>
            <span className="action__hint">Rewrites its bucket entries</span>
          </button>
          {txn.status === 'applied' && (
            <button
              className="action"
              onClick={() => {
                returnToInbox(txn.id)
                toast('Sent back to Inbox')
                onClose()
              }}
            >
              <span>Send back to Inbox</span>
              <span className="action__hint">Removes it from {bucket?.name ?? 'its bucket'}</span>
            </button>
          )}
          {confirmDelete ? (
            <div className="action action--confirm">
              <span>Delete for good? {txn.source === 'sms' ? 'The SMS stays blocked so it won’t come back.' : ''}</span>
              <span className="button-row">
                <button
                  className="button button--danger-fill button--small"
                  onClick={() => {
                    deleteTransaction(txn.id)
                    toast('Transaction deleted')
                    onClose()
                  }}
                >
                  Delete
                </button>
                <button className="button button--ghost button--small" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            </div>
          ) : (
            <button className="action action--danger" onClick={() => setConfirmDelete(true)}>
              <span>Delete transaction</span>
              <span className="action__hint">Every bucket goes back to how it was</span>
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}
