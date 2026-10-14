import { useState } from 'react'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Bar, Eyebrow, Money, Pill, Sheet } from '../components/ui.tsx'
import { formatINR, type LedgerKind } from '../core/index.ts'
import { amountDue, bufferBucket, findBucket, paymentAccountsFor } from '../data/operations.ts'
import { relativeTime, viewBucket } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import type { LedgerEntry } from '../data/types.ts'
import { useSheets } from '../lib/sheets.tsx'

const kindLabels: Record<LedgerKind, string> = {
  opening: 'Opening balance',
  allocation: 'Salary day',
  spend: 'Spent',
  refund: 'Refund',
  move: 'Moved',
  cover: 'Covered',
  sweep: 'Cycle close sweep',
  settlement: 'Difference settled',
  card_transfer: 'Card swipe reserved',
  card_payment: 'Card bill paid',
}

export function BucketSheet({ bucketId, onClose }: { bucketId: string; onClose: () => void }) {
  const { state, today, markPaid, cover, moveMoney, undoMove } = useStore()
  const { openTransaction, openAdd, toast } = useSheets()
  const [panel, setPanel] = useState<'move' | 'pay' | null>(null)
  const [moveAmount, setMoveAmount] = useState(0)
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [otherId, setOtherId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState(0)
  const [payAccountId, setPayAccountId] = useState<string | null>(null)
  const bucket = state.buckets.find((b) => b.id === bucketId)
  if (!bucket) return null
  const moving = panel === 'move'
  const paying = panel === 'pay'
  const payFrom = paymentAccountsFor(state, bucket)
  const payAccount = payFrom.find((a) => a.id === payAccountId)

  const togglePanel = (next: 'move' | 'pay') => {
    if (next === 'pay' && panel !== 'pay') {
      setPayAmount(amountDue(state, bucket))
      setPayAccountId(null)
    }
    setPanel(panel === next ? null : next)
  }

  const confirmPaid = () => {
    if (!payAccount || payAmount <= 0) return
    markPaid(bucket.id, { accountId: payAccount.id, amount: payAmount })
    toast(`${formatINR(payAmount)} paid from ${payAccount.name}`)
    setPanel(null)
  }

  const view = viewBucket(state, bucket, today)
  const buffer = bufferBucket(state)
  const entries = state.ledger
    .filter((e) => e.bucketId === bucket.id && e.cycleId === state.cycle.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const merchantFor = (txnId: string | null) => state.transactions.find((t) => t.id === txnId)?.merchant
  const others = state.buckets.filter((b) => b.id !== bucket.id)
  const counterpart = (entry: LedgerEntry) =>
    findBucket(state, state.ledger.find((e) => e.moveId === entry.moveId && e.id !== entry.id)?.bucketId)?.name

  const confirmMove = () => {
    if (!otherId || moveAmount <= 0) return
    const [from, to] = direction === 'out' ? [bucket.id, otherId] : [otherId, bucket.id]
    moveMoney(from, to, moveAmount)
    toast(`${formatINR(moveAmount)} moved`)
    setPanel(null)
    setMoveAmount(0)
    setOtherId(null)
  }

  return (
    <Sheet open onClose={onClose} title={bucket.name}>
      <div className="detail-hero">
        <Eyebrow>{bucket.type === 'committed' || bucket.type === 'bill' ? 'Reserved now' : bucket.type === 'card' ? 'Reserve' : 'Balance'}</Eyebrow>
        <Money value={view.balance} className="detail-hero__number" />
        <div className="detail-hero__row">
          <Pill mood={view.mood}>{view.label}</Pill>
          <span className="muted">{view.detail}</span>
        </div>
        {view.progress !== null && <Bar value={view.progress} mood={view.mood} />}
      </div>

      {view.overspent && buffer && buffer.id !== bucket.id && (
        <div className="callout callout--bad">
          <p>
            Over by <strong>{formatINR(-view.balance)}</strong>. Nothing is borrowed until you say so.
          </p>
          <button className="button button--ink" onClick={() => cover(bucket.id)}>
            Cover from {buffer.name}
          </button>
        </div>
      )}

      <div className="button-row">
        {view.canMarkPaid && (
          <button className={`button ${paying ? 'button--ink' : 'button--accent'}`} onClick={() => togglePanel('pay')}>
            {bucket.type === 'card' ? 'Mark bill paid' : 'Mark paid'}
          </button>
        )}
        {(bucket.type === 'flexible' || bucket.type === 'surplus') && (
          <button className="button button--ghost" onClick={() => openAdd(bucket.id)}>
            Add spend
          </button>
        )}
        <button className={`button ${moving ? 'button--ink' : 'button--ghost'}`} onClick={() => togglePanel('move')}>
          Move money
        </button>
      </div>

      {paying && (
        <div className="card edit-card">
          <MoneyInput value={payAmount} onChange={setPayAmount} size="lg" label="Amount paid" />
          <Eyebrow>Paid using</Eyebrow>
          <div className="chips">
            {payFrom.map((a) => (
              <button
                key={a.id}
                className={`chip ${payAccountId === a.id ? 'is-active' : ''}`}
                aria-pressed={payAccountId === a.id}
                onClick={() => setPayAccountId(payAccountId === a.id ? null : a.id)}
              >
                {a.name}
                {a.last4 ? ` ••${a.last4}` : ''}
              </button>
            ))}
          </div>
          {payAccount?.kind === 'card' && <p className="muted">Paid by card: the amount moves into the card bill reserve until the bill is paid.</p>}
          <button className="button button--ink button--block" disabled={!payAccount || payAmount <= 0} onClick={confirmPaid}>
            {payAccount ? `Mark ${formatINR(payAmount)} paid` : 'Choose how you paid'}
          </button>
        </div>
      )}

      {moving && (
        <div className="card edit-card">
          <div className="segmented" role="radiogroup">
            {(['out', 'in'] as const).map((d) => (
              <button key={d} role="radio" aria-checked={direction === d} className={`segmented__option ${direction === d ? 'is-active' : ''}`} onClick={() => setDirection(d)}>
                {d === 'out' ? `From ${bucket.name}` : `Into ${bucket.name}`}
              </button>
            ))}
          </div>
          <MoneyInput value={moveAmount} onChange={setMoveAmount} size="lg" label="Amount to move" />
          <Eyebrow>{direction === 'out' ? 'Move to' : 'Take from'}</Eyebrow>
          <div className="chips">
            {others.map((b) => (
              <button
                key={b.id}
                className={`chip ${otherId === b.id ? 'is-active' : ''}`}
                aria-pressed={otherId === b.id}
                onClick={() => setOtherId(otherId === b.id ? null : b.id)}
              >
                {b.name}
              </button>
            ))}
          </div>
          <button className="button button--ink button--block" disabled={!otherId || moveAmount <= 0} onClick={confirmMove}>
            Move {moveAmount > 0 ? formatINR(moveAmount) : ''}
          </button>
        </div>
      )}

      <Eyebrow>This cycle · tap to correct</Eyebrow>
      <div className="card list">
        {entries.length === 0 && <p className="empty-line">Nothing yet this cycle.</p>}
        {entries.map((entry) => {
          const body = (
            <>
              <span className="activity__main">
                <span className="activity__merchant">
                  {merchantFor(entry.transactionId) ?? (entry.moveId ? `${kindLabels[entry.kind]} ${entry.amount > 0 ? 'from' : 'to'} ${counterpart(entry) ?? '—'}` : kindLabels[entry.kind])}
                </span>
                <span className="activity__meta">
                  {kindLabels[entry.kind]} · {relativeTime(entry.at)}
                </span>
              </span>
              <Money value={entry.amount} className={entry.amount > 0 ? 'is-credit' : ''} />
            </>
          )
          if (entry.transactionId) {
            return (
              <button key={entry.id} className="activity activity--tap" onClick={() => openTransaction(entry.transactionId!)}>
                {body}
              </button>
            )
          }
          if (entry.moveId) {
            return (
              <div key={entry.id} className="activity">
                {body}
                <button
                  className="link link--inline"
                  onClick={() => {
                    undoMove(entry.moveId!)
                    toast('Move undone')
                  }}
                >
                  Undo
                </button>
              </div>
            )
          }
          return (
            <div key={entry.id} className="activity">
              {body}
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}
