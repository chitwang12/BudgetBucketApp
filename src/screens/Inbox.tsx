import { useState } from 'react'
import { Money, PageHeader } from '../components/ui.tsx'
import { inboxItems, relativeTime } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import type { Transaction } from '../data/types.ts'

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
  const [remember, setRemember] = useState(true)
  const account = state.accounts.find((a) => a.id === txn.accountId)
  const suggestion = state.buckets.find((b) => b.id === txn.suggestedBucketId)
  const choices = state.buckets
    .filter((b) => b.type !== 'surplus' || b.isBuffer)
    .sort((a, b) => Number(b.id === suggestion?.id) - Number(a.id === suggestion?.id))

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
          Looks like <strong>{suggestion.name}</strong>
          {txn.confidence !== null && <span> · {Math.round(txn.confidence * 100)}% sure</span>}
        </p>
      )}

      <div className="chips chips--scroll">
        {choices.map((b) => (
          <button key={b.id} className={`chip ${b.id === suggestion?.id ? 'is-suggested' : ''}`} onClick={() => assign(txn.id, b.id, remember)}>
            {b.name}
          </button>
        ))}
      </div>

      <footer className="inbox-card__footer">
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Always do this for {txn.merchant}</span>
        </label>
        <div className="inbox-card__links">
          <button className="link" onClick={() => markTransfer(txn.id)}>
            Transfer
          </button>
          <button className="link" onClick={() => ignore(txn.id)}>
            Ignore
          </button>
        </div>
      </footer>
    </article>
  )
}
