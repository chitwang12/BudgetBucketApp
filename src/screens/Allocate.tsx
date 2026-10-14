import { useMemo, useState } from 'react'
import { BackIcon } from '../components/Icons.tsx'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Eyebrow, Money } from '../components/ui.tsx'
import { cycleForSalaryDate, draftAllocation, rupees, unallocated, type AllocationLine, type Paise } from '../core/index.ts'
import { balanceOfBucket, pendingSalary } from '../data/operations.ts'
import { formatShortDate } from '../data/selectors.ts'
import { useStore } from '../data/store.tsx'
import { navigate } from '../lib/router.ts'

export function Allocate({ onDone }: { onDone: (message: string) => void }) {
  const { state, today, confirmSalary } = useStore()
  const nextCycle = cycleForSalaryDate(today, state.settings.cycleStartDay)
  const context = useMemo(
    () => ({
      cycleStart: nextCycle.start,
      cycleStartDay: state.settings.cycleStartDay,
      balances: new Map(state.buckets.map((b) => [b.id, balanceOfBucket(state, b.id)])),
    }),
    [state, nextCycle.start],
  )

  const fundable = state.buckets.filter((b) => !b.isReceivable)
  const [startIncome] = useState(() => pendingSalary(state)?.amount ?? (state.cycle.income || rupees(50_000)))
  const [income, setIncome] = useState<Paise>(startIncome)
  const [lines, setLines] = useState<AllocationLine[]>(() => draftAllocation(startIncome, fundable, context))
  const left = unallocated(income, lines)
  const buffer = state.buckets.find((b) => b.isBuffer)

  const setLine = (bucketId: string, amount: Paise) =>
    setLines((current) => current.map((line) => (line.bucketId === bucketId ? { ...line, amount } : line)))

  const changeIncome = (value: Paise) => {
    setIncome(value)
    setLines(draftAllocation(value, fundable, context))
  }

  const restToBuffer = () => {
    if (!buffer) return
    const current = lines.find((line) => line.bucketId === buffer.id)?.amount ?? 0
    setLine(buffer.id, Math.max(0, current + left))
  }

  const confirm = () => {
    confirmSalary(income, lines)
    onDone('New cycle started. Every rupee has a job.')
    navigate('/')
  }

  return (
    <div className="screen screen--allocate">
      <button className="back" onClick={() => navigate('/plan')}>
        <BackIcon /> Plan
      </button>
      <Eyebrow>
        New cycle · {formatShortDate(nextCycle.start)} – {formatShortDate(nextCycle.end)}
      </Eyebrow>
      <h1 className="display">Salary day</h1>

      <div className="card income">
        <Eyebrow>Take-home this month</Eyebrow>
        <MoneyInput value={income} onChange={changeIncome} size="lg" label="Salary" />
      </div>

      {state.groups.map((group) => {
        const buckets = fundable.filter((b) => b.groupId === group.id)
        if (buckets.length === 0) return null
        return (
          <section key={group.id} className={`group tone--${group.tone}`}>
            <header className="group__header">
              <h2 className="display display--sm">
                <span className="group__dot" />
                {group.name}
              </h2>
            </header>
            <div className="card list">
              {buckets.map((bucket) => {
                const amount = lines.find((line) => line.bucketId === bucket.id)?.amount ?? 0
                const ended = bucket.instalmentsRemaining === 0
                return (
                  <div key={bucket.id} className={`alloc-row ${ended ? 'is-ended' : ''}`}>
                    <span className="activity__main">
                      <span className="activity__merchant">{bucket.name}</span>
                      <span className="activity__meta">{ended ? 'Finished — no longer planned' : bucket.type === 'sinking' ? 'Monthly share of target' : `Plan ${Math.round(bucket.monthlyAmount / 100).toLocaleString('en-IN')}`}</span>
                    </span>
                    <MoneyInput value={amount} onChange={(value) => setLine(bucket.id, value)} label={`${bucket.name} amount`} />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <div className={`allocate-bar ${left === 0 ? 'is-zero' : left < 0 ? 'is-over' : ''}`}>
        <div>
          <Eyebrow>{left < 0 ? 'Over-allocated' : 'Unallocated'}</Eyebrow>
          <Money value={left} className="allocate-bar__value" />
        </div>
        {left !== 0 && buffer && left > 0 ? (
          <button className="button button--ghost" onClick={restToBuffer}>
            Rest to buffer
          </button>
        ) : (
          <button className="button button--ink" disabled={left !== 0} onClick={confirm}>
            Confirm
          </button>
        )}
      </div>
    </div>
  )
}
