import { useState } from 'react'
import { Money, PageHeader } from '../components/ui.tsx'
import { inboxItems, relativeTime } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import type { Transaction } from '../data/types.ts'
import { useSheets } from '../lib/sheets.tsx'

export function Inbox() {
  const { state } = useStore()
  const items = inboxItems(state)

  return (
    <div className="screen">
      <PageHeader eyebrow={items.length ? `${items.length} waiting` : 'All sorted'} title="Inbox" />
      {items.length === 0 ? (
        <div className="empty">
          <p className="display display--xl">Inbox zero.</p>
          <p className="muted">Every transaction has a bucket. New ones the app isn't sure about will land here.</p>
        </div>
      ) : (
        items.map((txn) => <InboxCard key={txn.id} txn={txn} />)
      )}
    </div>
  )
}

function InboxCard({ txn }: { txn: Transaction }) {
  const { state, assign, ignore, markTransfer } = useStore()
  const isCredit = txn.direction === 'credit'
  // A rule learned from money received would also catch payments to that person.
  const [remember, setRemember] = useState(!isCredit)
  const [selectedId, setSelectedId] = useState<string | null>(isCredit ? txn.suggestedBucketId : null)
  const account = state.accounts.find((a) => a.id === txn.accountId)
  const suggestion = state.buckets.find((b) => b.id === txn.suggestedBucketId)
  const selected = state.buckets.find((b) => b.id === selectedId)
  const choices = state.buckets
    .filter((b) => b.type !== 'surplus' || b.isBuffer)
    .sort((a, b) => Number(b.id === suggestion?.id) - Number(a.id === suggestion?.id))
  const { toast } = useSheets()

  const transfer = () => {
    if (!selected) return
    assign(txn.id, selected.id, remember)
    toast(`${txn.merchant} → ${selected.name}`)
  }

  return (
    <article className="card inbox-card">
      <header className="inbox-card__header">
        <div>
          <h2 className="inbox-card__merchant">{txn.merchant}</h2>
          <p className="eyebrow">
            {account ? `${account.name}${account.last4 ? ` ••${account.last4}` : ''}` : 'Unknown account'} · {relativeTime(txn.occurredAt)}
          </p>
        </div>
        <Money value={txn.direction === 'debit' ? -txn.amount : txn.amount} className="inbox-card__amount" />
      </header>

      {txn.smsRedacted && <p className="sms">{txn.smsRedacted}</p>}

      {suggestion && (
        <p className="suggestion">
          {isCredit ? (
            <>
              Money received · add it to <strong>{suggestion.name}</strong>, or pick the bucket it pays back
            </>
          ) : (
            <>
              Looks like <strong>{suggestion.name}</strong>
              {txn.confidence !== null && <span> · {Math.round(txn.confidence * 100)}% sure</span>}
            </>
          )}
        </p>
      )}

      <div className="chips chips--scroll">
        {choices.map((b) => (
          <button
            key={b.id}
            className={`chip ${b.id === selectedId ? 'is-active' : b.id === suggestion?.id ? 'is-suggested' : ''}`}
            aria-pressed={b.id === selectedId}
            onClick={() => setSelectedId(b.id === selectedId ? null : b.id)}
          >
            {b.name}
          </button>
        ))}
      </div>

      <button className="button button--ink button--block" disabled={!selected} onClick={transfer}>
        {selected ? `${isCredit ? 'Add to' : 'Transfer to'} ${selected.name}` : 'Pick a bucket'}
      </button>

      <footer className="inbox-card__footer">
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Always do this for {txn.merchant}</span>
        </label>
        <div className="inbox-card__links">
          <button className="link" onClick={() => markTransfer(txn.id)}>
            Own account
          </button>
          <button className="link" onClick={() => ignore(txn.id)}>
            Ignore
          </button>
        </div>
      </footer>
    </article>
  )
}
