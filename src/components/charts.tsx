import { formatINR, type Paise } from '../core/index.ts'
import type { PacePoint } from '../data/analytics.ts'

/** Cumulative everyday spend against the straight-line plan, drawn edge to edge. */
export function PaceChart({ points, elapsed }: { points: PacePoint[]; elapsed: number }) {
  const width = 300
  const height = 120
  const max = Math.max(1, ...points.map((p) => Math.max(p.plan, p.actual ?? 0))) * 1.08
  const x = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * width)
  const y = (v: number) => height - (v / max) * height
  const plan = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.plan).toFixed(1)}`).join(' ')
  const actualPoints = points.slice(0, elapsed)
  const actual = actualPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.actual ?? 0).toFixed(1)}`).join(' ')
  const area = `${actual} L${x(actualPoints.length - 1).toFixed(1)},${height} L0,${height} Z`
  const last = actualPoints.at(-1)
  const dotLeft = (x(actualPoints.length - 1) / width) * 100
  const dotTop = last ? (y(last.actual ?? 0) / height) * 100 : 100

  return (
    <div className="pace">
      <div className="pace__plot">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="pace-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ffab4b" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#ffab4b" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={plan} className="pace__plan" vectorEffect="non-scaling-stroke" />
          {actualPoints.length > 1 && <path d={area} fill="url(#pace-fill)" />}
          {actualPoints.length > 1 && <path d={actual} className="pace__actual" vectorEffect="non-scaling-stroke" />}
        </svg>
        {last && <span className="pace__dot" style={{ left: `${dotLeft}%`, top: `${dotTop}%` }} />}
      </div>
      <div className="pace__axis">
        <span>Day 1</span>
        {elapsed > 1 && elapsed < points.length && (
          <span className="pace__today" style={{ left: `${Math.min(80, Math.max(20, dotLeft))}%` }}>
            Today
          </span>
        )}
        <span>Day {points.length}</span>
      </div>
    </div>
  )
}

export interface StackSegment {
  key: string
  value: Paise
}

export interface StackColumn {
  id: string
  label: string
  caption: string
  segments: StackSegment[]
  inProgress?: boolean
}

/** Vertical stacked columns, one per cycle. Tapping a column selects it. */
export function StackedBars({
  columns,
  selectedId,
  onSelect,
}: {
  columns: StackColumn[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const max = Math.max(1, ...columns.map((c) => c.segments.reduce((s, seg) => s + Math.max(0, seg.value), 0)))
  return (
    <div className="stacks" role="list">
      {columns.map((column) => (
        <button
          key={column.id}
          role="listitem"
          className={`stacks__col ${selectedId === column.id ? 'is-selected' : ''} ${column.inProgress ? 'is-progress' : ''}`}
          onClick={() => onSelect(column.id)}
          aria-label={`${column.label}: ${column.segments.map((s) => `${s.key} ${formatINR(s.value)}`).join(', ')}`}
        >
          <span className="stacks__bar">
            {column.segments.map((segment) =>
              segment.value > 0 ? (
                <span key={segment.key} className={`stacks__seg seg--${segment.key}`} style={{ height: `${(segment.value / max) * 100}%` }} />
              ) : null,
            )}
          </span>
          <span className="stacks__label">{column.label}</span>
          <span className="stacks__caption">{column.caption}</span>
        </button>
      ))}
    </div>
  )
}

/** Tiny per-cycle bars with the plan drawn as a line, for plan-vs-actual rows. */
export function SparkBars({ values, plan }: { values: Paise[]; plan: Paise }) {
  const max = Math.max(1, plan, ...values) * 1.1
  return (
    <span className="spark" aria-hidden="true">
      {values.map((value, i) => (
        <span key={i} className={`spark__bar ${value > plan ? 'is-over' : ''}`} style={{ height: `${Math.max(4, (value / max) * 100)}%` }} />
      ))}
      <span className="spark__plan" style={{ bottom: `${(plan / max) * 100}%` }} />
    </span>
  )
}

export function WeekdayBars({ values, labels }: { values: Paise[]; labels: string[] }) {
  const max = Math.max(1, ...values)
  const peak = values.indexOf(max)
  return (
    <div className="weekdays">
      {values.map((value, i) => (
        <div key={labels[i]} className={`weekdays__col ${i === peak ? 'is-peak' : ''}`}>
          <span className="weekdays__value">{i === peak ? formatINR(Math.round(value / 100) * 100) : ''}</span>
          <span className="weekdays__track">
            <span className="weekdays__bar" style={{ height: `${Math.max(3, (value / max) * 100)}%` }} />
          </span>
          <span className="weekdays__label">{labels[i].slice(0, 2)}</span>
        </div>
      ))}
    </div>
  )
}

export function ShareBar({ parts }: { parts: { key: string; value: Paise }[] }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1
  return (
    <div className="share" aria-hidden="true">
      {parts.map((part) =>
        part.value > 0 ? <span key={part.key} className={`share__seg seg--${part.key}`} style={{ width: `${(part.value / total) * 100}%` }} /> : null,
      )}
    </div>
  )
}
