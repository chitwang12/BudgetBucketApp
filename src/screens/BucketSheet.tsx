import { useState } from 'react'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Bar, Eyebrow, Money, Pill, Sheet } from '../components/ui.tsx'
import { formatINR, type LedgerKind } from '../core/index.ts'
import { bufferBucket } from '../data/operations.ts'
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
  const [moving, setMoving] = useState(false)
  const [moveAmount, setMoveAmount] = useState(0)
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [otherId, setOtherId] = useState<string | null>(null)
  const bucket = state.buckets.find((b) => b.id === bucketId)
  if (!bucket) return null

  const view = viewBucket(state, bucket, today)
  const buffer = bufferBucket(state)
  const entries = state.ledger
    .filter((e) => e.bucketId === bucket.id && e.cycleId === state.cycle.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const merchantFor = (txnId: string | null) => state.transactions.find((t) => t.id === txnId)?.merchant
  const others = state.buckets.filter((b) => b.id !== bucket.id)
  const counterpart = (entry: LedgerEntry) =>
    state.buckets.find((b) => b.id === state.ledger.find((e) => e.moveId === entry.moveId && e.id !== entry.id)?.bucketId)?.name

  const confirmMove = () => {
    if (!otherId || moveAmount <= 0) return
    const [from, to] = direction === 'out' ? [bucket.id, otherId] : [otherId, bucket.id]
    moveMoney(from, to, moveAmount)
    toast(`${formatINR(moveAmount)} moved`)
    setMoving(false)
    setMoveAmount(0)
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
          <button className="button button--accent" onClick={() => markPaid(bucket.id)}>
            {bucket.type === 'card' ? 'Mark bill paid' : 'Mark paid'}
          </button>
        )}
        {(bucket.type === 'flexible' || bucket.type === 'surplus') && (
          <button className="button button--ghost" onClick={() => openAdd(bucket.id)}>
            Add spend
          </button>
        )}
        <button className={`button ${moving ? 'button--ink' : 'button--ghost'}`} onClick={() => setMoving((m) => !m)}>
          Move money
        </button>
      </div>

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
              <button key={b.id} className={`chip ${otherId === b.id ? 'is-active' : ''}`} onClick={() => setOtherId(b.id)}>
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
