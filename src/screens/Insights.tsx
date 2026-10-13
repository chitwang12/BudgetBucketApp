import { useMemo, useState, type CSSProperties } from 'react'
import { PaceChart, ShareBar, SparkBars, StackedBars, WeekdayBars, type StackColumn } from '../components/charts.tsx'
import { Bar, Eyebrow, Money, PageHeader, Pill, Segmented } from '../components/ui.tsx'
import { formatINR, type Paise } from '../core/index.ts'
import {
  buildReports,
  insights,
  merchantStats,
  pace,
  planVsActual,
  spendGroupOf,
  weekdayPattern,
  WEEKDAYS,
  type CycleReport,
  type PaymentRecord,
} from '../data/analytics.ts'
import { formatShortDate } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'

type Range = '3' | '6' | 'all'

const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
const pct = (value: number) => `${Math.round(value * 100)}%`
const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length / 100) * 100 : 0)

const GROUP_LABELS = { committed: 'Committed', bills: 'Bills', everyday: 'Everyday', sinking: 'Sinking funds', left: 'Left over' } as const

function cycleLabel(report: CycleReport): string {
  return monthShort.format(new Date(`${report.cycle.start}T00:00:00Z`))
}

export function Insights() {
  const { state, today } = useStore()
  const [range, setRange] = useState<Range>('6')
  const reports = useMemo(() => buildReports(state, today), [state, today])
  const current = reports.at(-1)!
  const closed = reports.slice(0, -1)
  const inRange = range === 'all' ? closed : closed.slice(-Number(range))
  const [selectedId, setSelectedId] = useState<string>(closed.at(-1)?.cycle.id ?? current.cycle.id)
  const selected = reports.find((r) => r.cycle.id === selectedId) ?? current

  const notes = useMemo(() => insights(state, reports), [state, reports])
  const paceInfo = pace(current)
  const pva = planVsActual(state, [...inRange, current])
  const merchants = merchantStats(state, inRange.map((r) => r.cycle))
  const weekdays = weekdayPattern(inRange)

  const columns: StackColumn[] = [...inRange, current].map((report) => ({
    id: report.cycle.id,
    label: cycleLabel(report),
    caption: report.isCurrent ? 'now' : pct(report.savingsRate),
    inProgress: report.isCurrent,
    segments: [
      { key: 'committed', value: report.byGroup.committed },
      { key: 'bills', value: report.byGroup.bills },
      { key: 'everyday', value: report.byGroup.everyday },
      { key: 'sinking', value: report.byGroup.sinking },
      { key: 'left', value: report.isCurrent ? 0 : Math.max(0, report.leftOver) },
    ],
  }))

  const groupTotals = (['committed', 'bills', 'everyday', 'sinking'] as const).map((key) => ({
    key,
    value: average(inRange.map((r) => r.byGroup[key])),
  }))
  const leftAverage = average(inRange.map((r) => r.leftOver))

  return (
    <div className="screen">
      <PageHeader eyebrow={`${closed.length} closed cycles`} title="Insights" />

      <section className="pace-card">
        <Eyebrow>
          This cycle · day {current.elapsed} of {current.length}
        </Eyebrow>
        <div className="pace-card__numbers">
          <Money value={paceInfo.spent} className="pace-card__big" />
          <span className="pace-card__of">
            of <Money value={current.everydayPlanned} /> everyday plan
          </span>
        </div>
        <p className={`pace-card__delta ${paceInfo.difference > 0 ? 'is-ahead' : 'is-behind'}`}>
          {paceInfo.difference > 0
            ? `${formatINR(paceInfo.difference)} ahead of a steady pace`
            : `${formatINR(-paceInfo.difference)} under a steady pace`}
        </p>
        <PaceChart points={paceInfo.points} elapsed={current.elapsed} />
        <div className="legend legend--dark">
          <span className="legend__item">
            <span className="legend__swatch legend__swatch--line" /> Spent
          </span>
          <span className="legend__item">
            <span className="legend__swatch legend__swatch--dash" /> Steady pace
          </span>
        </div>
      </section>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">What stands out</h2>
        </header>
        <ol className="notes">
          {notes.map((note, index) => (
            <li key={note.title} className={`note note--${note.tone}`}>
              <span className="note__index">{String(index + 1).padStart(2, '0')}</span>
              <span className="note__body">
                <strong>{note.title}</strong>
                <span>{note.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="range-bar">
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: '3', label: 'Last 3' },
            { value: '6', label: 'Last 6' },
            { value: 'all', label: 'All cycles' },
          ]}
        />
      </div>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Month by month</h2>
          <span className="eyebrow">% kept</span>
        </header>
        <div className="card chart-card">
          <StackedBars columns={columns} selectedId={selected.cycle.id} onSelect={setSelectedId} />
          <div className="legend">
            {(['committed', 'bills', 'everyday', 'sinking', 'left'] as const).map((key) => (
              <span key={key} className="legend__item">
                <span className={`legend__swatch seg--${key}`} /> {GROUP_LABELS[key]}
              </span>
            ))}
          </div>
        </div>
        <CycleDetail report={selected} />
      </section>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Where it goes</h2>
          <span className="eyebrow">avg / cycle</span>
        </header>
        <div className="card chart-card">
          <ShareBar parts={[...groupTotals, { key: 'left', value: leftAverage }]} />
          <div className="list list--flat">
            {[...groupTotals, { key: 'left' as const, value: leftAverage }].map((row) => {
              const income = average(inRange.map((r) => r.income)) || 1
              return (
                <div key={row.key} className="share-row">
                  <span className={`legend__swatch seg--${row.key}`} />
                  <span className="share-row__name">{GROUP_LABELS[row.key]}</span>
                  <span className="share-row__pct">{pct(row.value / income)}</span>
                  <Money value={row.value} />
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Plan vs actual</h2>
          <span className="eyebrow">everyday</span>
        </header>
        <div className="card list">
          {pva.map((row) => (
            <div key={row.bucket.id} className="pva">
              <div className="pva__top">
                <span className="pva__name">{row.bucket.name}</span>
                <SparkBars values={[...row.series]} plan={row.plan} />
              </div>
              <div className="pva__bottom">
                <span className="activity__meta">
                  avg {formatINR(row.average)} · plan {formatINR(row.plan)}
                  {row.change !== null && ` · last ${row.change >= 0 ? '+' : '−'}${pct(Math.abs(row.change))}`}
                </span>
                <Pill mood={row.overCount === 0 ? 'good' : row.overCount * 2 > row.closedCount ? 'bad' : 'warn'}>
                  Over {row.overCount}/{row.closedCount}
                </Pill>
              </div>
              {row.suggestion && <p className="pva__tip">Try a plan of {formatINR(row.suggestion)}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Top merchants</h2>
          <span className="eyebrow">everyday</span>
        </header>
        <div className="card list">
          {merchants.map((m, index) => (
            <div key={m.name} className="merchant">
              <span className="merchant__rank">{index + 1}</span>
              <span className="merchant__main">
                <span className="activity__merchant">{m.name}</span>
                <span className="activity__meta">
                  {m.count}× · avg {formatINR(m.average)} · {m.bucketName}
                </span>
                <Bar value={m.share / (merchants[0]?.share || 1)} mood="warn" />
              </span>
              <span className="merchant__side">
                <Money value={m.total} />
                <span className="activity__meta">{pct(m.share)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">By weekday</h2>
          <span className="eyebrow">avg everyday spend</span>
        </header>
        <div className="card chart-card">
          <WeekdayBars values={weekdays} labels={WEEKDAYS} />
        </div>
      </section>

      <section className="group">
        <header className="group__header">
          <h2 className="display display--sm">Commitments</h2>
          <span className="eyebrow">paid in window</span>
        </header>
        <CommitmentGrid reports={[...inRange, current]} />
      </section>
    </div>
  )
}

function CycleDetail({ report }: { report: CycleReport }) {
  const { state } = useStore()
  const rows = state.buckets
    .filter((b) => spendGroupOf(b) !== null)
    .map((bucket) => ({ bucket, spent: report.spentByBucket.get(bucket.id) ?? 0, funded: report.fundedByBucket.get(bucket.id) ?? 0 }))
    .filter((row) => row.spent !== 0 || row.funded !== 0)
    .sort((a, b) => b.spent - a.spent)

  return (
    <div className="card cycle-detail">
      <header className="cycle-detail__header">
        <div>
          <Eyebrow>{report.isCurrent ? 'This cycle so far' : 'Closed cycle'}</Eyebrow>
          <p className="display display--md">
            {formatShortDate(report.cycle.start)} – {formatShortDate(report.cycle.end)}
          </p>
        </div>
        {!report.isCurrent && <Pill mood={report.savingsRate >= 0.2 ? 'good' : 'warn'}>Kept {pct(report.savingsRate)}</Pill>}
      </header>
      <div className="stat-grid">
        <Stat label="Income" value={report.income} />
        <Stat label="Spent" value={report.outflow} />
        <Stat label={report.isCurrent ? 'Not spent yet' : 'Left over'} value={report.leftOver} />
        <div className="stat-grid__item">
          <Eyebrow>Activity</Eyebrow>
          <span className="stat-grid__value">{report.transactionCount}</span>
          <span className="activity__meta">
            {report.overspent.length} over · {report.covers} covered
          </span>
        </div>
      </div>
      <div className="list list--flat">
        {rows.map(({ bucket, spent, funded }) => (
          <div key={bucket.id} className="detail-row">
            <span className="detail-row__top">
              <span className="detail-row__name">{bucket.name}</span>
              <span className="detail-row__amount">
                <Money value={spent} />
                {funded > 0 && <span className="activity__meta"> / {formatINR(funded)}</span>}
              </span>
            </span>
            {funded > 0 && <Bar value={spent / funded} mood={spent > funded ? 'bad' : spent / funded >= 0.8 ? 'warn' : 'good'} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: Paise }) {
  return (
    <div className="stat-grid__item">
      <Eyebrow>{label}</Eyebrow>
      <Money value={value} className="stat-grid__value" />
    </div>
  )
}

const DOT_LABEL: Record<PaymentRecord['status'], string> = { on_time: 'On time', late: 'Late', missed: 'Missed', pending: 'Not due yet' }

function CommitmentGrid({ reports }: { reports: CycleReport[] }) {
  const { state } = useStore()
  const committed = state.buckets.filter((b) => b.type === 'committed' && b.dueWindow)
  return (
    <div className="card commit-grid" style={{ '--cols': reports.length } as CSSProperties}>
      <div className="commit-grid__row commit-grid__head">
        <span />
        {reports.map((r) => (
          <span key={r.cycle.id} className="commit-grid__month">
            {cycleLabel(r)}
          </span>
        ))}
      </div>
      {committed.map((bucket) => {
        const records = reports.map((r) => r.payments.find((p) => p.bucketId === bucket.id))
        const onTime = records.filter((r) => r?.status === 'on_time').length
        const counted = records.filter((r) => r && r.status !== 'pending').length
        return (
          <div key={bucket.id} className="commit-grid__row">
            <span className="commit-grid__name">
              {bucket.name}
              <span className="activity__meta">
                {onTime}/{counted} on time
              </span>
            </span>
            {records.map((record, i) => (
              <span
                key={reports[i].cycle.id}
                className={`dot dot--${record?.status ?? 'none'}`}
                title={record ? `${DOT_LABEL[record.status]}${record.paidOn ? ` · paid ${formatShortDate(record.paidOn)}` : ''}` : 'Not planned'}
              />
            ))}
          </div>
        )
      })}
      <div className="legend">
        {(['on_time', 'late', 'missed', 'pending'] as const).map((s) => (
          <span key={s} className="legend__item">
            <span className={`dot dot--${s}`} /> {DOT_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
