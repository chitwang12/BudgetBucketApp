import type { BucketView } from '../data/selectors.ts'
import { Bar, Money, Pill } from './ui.tsx'

export function BucketRow({ view, onOpen }: { view: BucketView; onOpen: (bucketId: string) => void }) {
  return (
    <button className={`bucket-row ${view.overspent ? 'is-overspent' : ''}`} onClick={() => onOpen(view.bucket.id)}>
      <span className="bucket-row__top">
        <span className="bucket-row__name">{view.bucket.name}</span>
        <Money value={view.bucket.isReceivable ? -view.balance : view.balance} className="bucket-row__amount" />
      </span>
      <span className="bucket-row__bottom">
        <span className="bucket-row__detail">{view.detail}</span>
        <Pill mood={view.mood}>{view.label}</Pill>
      </span>
      {view.progress !== null && <Bar value={view.progress} mood={view.mood} />}
    </button>
  )
}
