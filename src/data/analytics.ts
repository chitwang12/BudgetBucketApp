import { addDays, dateInZone, diffDays, dueWindowInCycle, formatINR, normaliseMerchant, type IsoDate, type Paise } from '../core/index.ts'
import type { AppState, Cycle, PlannedBucket } from './types.ts'

/** Averages are shown to the rupee; paise in an average is noise. */
const wholeRupees = (paise: number): Paise => Math.round(paise / 100) * 100

export type SpendGroup = 'committed' | 'bills' | 'everyday' | 'sinking'

export function spendGroupOf(bucket: PlannedBucket): SpendGroup | null {
  switch (bucket.type) {
    case 'committed':
      return 'committed'
    case 'bill':
      return 'bills'
    case 'flexible':
      return 'everyday'
    case 'sinking':
      return 'sinking'
    default:
      return null
  }
}

export type PaymentRecord = { bucketId: string; dueEnd: IsoDate; paidOn: IsoDate | null; status: 'on_time' | 'late' | 'missed' | 'pending' }

export interface CycleReport {
  cycle: Cycle
  isCurrent: boolean
  length: number
  /** Days counted so far: the whole cycle once closed. */
  elapsed: number
  income: Paise
  /** Net spending per bucket (payments minus refunds). Card bill payments are transfers and excluded. */
  spentByBucket: Map<string, Paise>
  fundedByBucket: Map<string, Paise>
  byGroup: Record<SpendGroup, Paise>
  outflow: Paise
  leftOver: Paise
  savingsRate: number
  everydayPlanned: Paise
  /** Everyday spending per day of the cycle. */
  daily: Paise[]
  overspent: string[]
  covers: number
  payments: PaymentRecord[]
  transactionCount: number
}

function localDate(state: AppState, iso: string): IsoDate {
  return dateInZone(new Date(iso), state.settings.timezone)
}

/** Live and archived buckets, for reading history. */
export function everyBucket(state: AppState): PlannedBucket[] {
  return [...state.buckets, ...state.archivedBuckets]
}

export function allCycles(state: AppState): Cycle[] {
  return [...state.history, state.cycle]
}

export function buildReport(state: AppState, cycle: Cycle, today: IsoDate): CycleReport {
  const isCurrent = cycle.id === state.cycle.id
  const length = diffDays(cycle.start, cycle.end) + 1
  const elapsed = isCurrent ? Math.min(length, Math.max(1, diffDays(cycle.start, today) + 1)) : length
  const buckets = new Map(everyBucket(state).map((b) => [b.id, b]))
  const spentByBucket = new Map<string, Paise>()
  const fundedByBucket = new Map<string, Paise>()
  const daily = Array.from({ length }, () => 0)
  const firstPayment = new Map<string, IsoDate>()
  let covers = 0

  for (const entry of state.ledger) {
    if (entry.cycleId !== cycle.id) continue
    const bucket = buckets.get(entry.bucketId)
    if (!bucket) continue
    if (entry.kind === 'spend' || entry.kind === 'refund') {
      spentByBucket.set(bucket.id, (spentByBucket.get(bucket.id) ?? 0) - entry.amount)
      if (bucket.type === 'flexible') {
        const day = diffDays(cycle.start, localDate(state, entry.at))
        if (day >= 0 && day < length) daily[day] -= entry.amount
      }
      if (entry.kind === 'spend' && !firstPayment.has(bucket.id)) firstPayment.set(bucket.id, localDate(state, entry.at))
    }
    if (entry.amount > 0 && (entry.kind === 'allocation' || entry.kind === 'cover' || entry.kind === 'move')) {
      fundedByBucket.set(bucket.id, (fundedByBucket.get(bucket.id) ?? 0) + entry.amount)
    }
    if (entry.kind === 'cover' && entry.amount > 0) covers++
  }

  const byGroup: Record<SpendGroup, Paise> = { committed: 0, bills: 0, everyday: 0, sinking: 0 }
  for (const [bucketId, spent] of spentByBucket) {
    const group = spendGroupOf(buckets.get(bucketId)!)
    if (group) byGroup[group] += spent
  }
  const outflow = byGroup.committed + byGroup.bills + byGroup.everyday + byGroup.sinking
  const income = cycle.income

  const everyday = everyBucket(state).filter((b) => b.type === 'flexible')
  const overspent = everyday.filter((b) => (spentByBucket.get(b.id) ?? 0) > (fundedByBucket.get(b.id) ?? 0) && (fundedByBucket.get(b.id) ?? 0) > 0).map((b) => b.id)

  const payments: PaymentRecord[] = everyBucket(state)
    .filter((b) => b.type === 'committed' && b.dueWindow && (fundedByBucket.get(b.id) ?? 0) > 0)
    .map((b) => {
      const window = dueWindowInCycle(b.dueWindow!, cycle)
      const paidOn = firstPayment.get(b.id) ?? null
      const status: PaymentRecord['status'] = paidOn
        ? paidOn <= window.end
          ? 'on_time'
          : 'late'
        : isCurrent && today <= window.end
          ? 'pending'
          : 'missed'
      return { bucketId: b.id, dueEnd: window.end, paidOn, status }
    })

  const transactionCount = state.transactions.filter((t) => {
    if (t.status !== 'applied') return false
    const date = localDate(state, t.occurredAt)
    return date >= cycle.start && date <= cycle.end
  }).length

  return {
    cycle,
    isCurrent,
    length,
    elapsed,
    income,
    spentByBucket,
    fundedByBucket,
    byGroup,
    outflow,
    leftOver: income - outflow,
    savingsRate: income > 0 ? (income - outflow) / income : 0,
    everydayPlanned: everyday.reduce((sum, b) => sum + (fundedByBucket.get(b.id) ?? 0), 0),
    daily,
    overspent,
    covers,
    payments,
    transactionCount,
  }
}

/** Reports for every cycle, oldest first, with the current cycle last. */
export function buildReports(state: AppState, today: IsoDate): CycleReport[] {
  return allCycles(state).map((cycle) => buildReport(state, cycle, today))
}

export interface PacePoint {
  day: number
  actual: Paise | null
  plan: Paise
}

/** Cumulative everyday spending against a straight-line spend of the plan across the cycle. */
export function pace(report: CycleReport): { points: PacePoint[]; spent: Paise; expected: Paise; difference: Paise } {
  let running = 0
  const points = report.daily.map((amount, index) => {
    running += amount
    return {
      day: index + 1,
      actual: index < report.elapsed ? running : null,
      plan: wholeRupees((report.everydayPlanned * (index + 1)) / report.length),
    }
  })
  const spent = points[report.elapsed - 1]?.actual ?? 0
  const expected = points[report.elapsed - 1]?.plan ?? 0
  return { points, spent, expected, difference: spent - expected }
}

export interface PlanVsActual {
  bucket: PlannedBucket
  plan: Paise
  series: Paise[]
  average: Paise
  overCount: number
  closedCount: number
  latest: Paise
  /** Change of the latest closed cycle against the average of the ones before it. */
  change: number | null
  suggestion: Paise | null
}

export function planVsActual(state: AppState, reports: CycleReport[]): PlanVsActual[] {
  const closed = reports.filter((r) => !r.isCurrent)
  return state.buckets
    .filter((b) => b.type === 'flexible')
    .map((bucket) => {
      const series = closed.map((r) => r.spentByBucket.get(bucket.id) ?? 0)
      const average = series.length ? wholeRupees(series.reduce((a, b) => a + b, 0) / series.length) : 0
      const overCount = closed.filter((r) => r.overspent.includes(bucket.id)).length
      const latest = series.at(-1) ?? 0
      const before = series.slice(0, -1)
      const beforeAverage = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0
      const change = beforeAverage > 0 ? (latest - beforeAverage) / beforeAverage : null
      const suggestion = overCount * 2 > closed.length && average > bucket.monthlyAmount ? Math.ceil(average / 10_000) * 10_000 : null
      return { bucket, plan: bucket.monthlyAmount, series, average, overCount, closedCount: closed.length, latest, change, suggestion }
    })
}

export interface MerchantStat {
  name: string
  total: Paise
  count: number
  average: Paise
  bucketName: string | null
  share: number
}

function displayMerchant(raw: string): string {
  const name = normaliseMerchant(raw)
    .replace(/\b(in|india|pvt|ltd|avenue)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name.replace(/\b\w/g, (c) => c.toUpperCase()) || raw
}

/** Where everyday money went, by merchant, across the given cycles. */
export function merchantStats(state: AppState, cycles: Cycle[], limit = 8): MerchantStat[] {
  const everyday = new Set(everyBucket(state).filter((b) => b.type === 'flexible').map((b) => b.id))
  const names = new Map(everyBucket(state).map((b) => [b.id, b.name]))
  const totals = new Map<string, { total: Paise; count: number; buckets: Map<string, number> }>()
  let grand = 0
  for (const txn of state.transactions) {
    if (txn.status !== 'applied' || txn.direction !== 'debit' || !txn.bucketId || !everyday.has(txn.bucketId)) continue
    const date = localDate(state, txn.occurredAt)
    if (!cycles.some((c) => date >= c.start && date <= c.end)) continue
    const name = displayMerchant(txn.merchant)
    const stat = totals.get(name) ?? { total: 0, count: 0, buckets: new Map() }
    const mine = txn.myShare ?? txn.amount
    stat.total += mine
    stat.count++
    stat.buckets.set(txn.bucketId, (stat.buckets.get(txn.bucketId) ?? 0) + 1)
    totals.set(name, stat)
    grand += mine
  }
  return [...totals.entries()]
    .map(([name, stat]) => {
      const topBucket = [...stat.buckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      return {
        name,
        total: stat.total,
        count: stat.count,
        average: wholeRupees(stat.total / stat.count),
        bucketName: topBucket ? (names.get(topBucket) ?? null) : null,
        share: grand > 0 ? stat.total / grand : 0,
      }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Average everyday spending on each weekday (Monday first) across the given reports. */
export function weekdayPattern(reports: CycleReport[]): Paise[] {
  const totals = Array.from({ length: 7 }, () => 0)
  const days = Array.from({ length: 7 }, () => 0)
  for (const report of reports) {
    for (let day = 0; day < report.elapsed; day++) {
      const weekday = (new Date(`${addDays(report.cycle.start, day)}T00:00:00Z`).getUTCDay() + 6) % 7
      totals[weekday] += report.daily[day]
      days[weekday]++
    }
  }
  return totals.map((total, i) => (days[i] ? wholeRupees(total / days[i]) : 0))
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'calm'

export interface Insight {
  tone: InsightTone
  title: string
  body: string
}

const percent = (value: number) => `${Math.round(Math.abs(value) * 100)}%`

/** Plain-language observations, most actionable first. */
export function insights(state: AppState, reports: CycleReport[]): Insight[] {
  const result: Insight[] = []
  const current = reports.at(-1)
  const closed = reports.filter((r) => !r.isCurrent)
  const names = new Map(everyBucket(state).map((b) => [b.id, b.name]))

  if (current && current.everydayPlanned > 0) {
    const { difference, spent, expected } = pace(current)
    const ratio = expected > 0 ? difference / expected : 0
    if (ratio > 0.1) {
      result.push({
        tone: 'bad',
        title: `${formatINR(difference)} ahead of pace`,
        body: `By day ${current.elapsed} you'd normally have spent ${formatINR(expected)} on everyday buckets; you've spent ${formatINR(spent)}. Easing off for a few days brings it back in line.`,
      })
    } else if (ratio < -0.1) {
      result.push({
        tone: 'good',
        title: `${formatINR(-difference)} under pace`,
        body: `Everyday spending is ${percent(ratio)} below a straight-line spend of your plan for day ${current.elapsed}.`,
      })
    } else {
      result.push({ tone: 'calm', title: 'Right on pace', body: `Everyday spending is within 10% of plan for day ${current.elapsed} of ${current.length}.` })
    }
  }

  for (const row of planVsActual(state, reports)) {
    if (row.suggestion) {
      result.push({
        tone: 'warn',
        title: `${row.bucket.name} runs over`,
        body: `Over plan in ${row.overCount} of the last ${row.closedCount} cycles, averaging ${formatINR(row.average)} against a ${formatINR(row.plan)} plan. A plan of ${formatINR(row.suggestion)} would match how you actually spend.`,
      })
    }
  }

  const changes = planVsActual(state, reports).filter((r) => r.change !== null && Math.abs(r.change) >= 0.15)
  const biggest = changes.sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))[0]
  if (biggest) {
    const up = biggest.change! > 0
    result.push({
      tone: up ? 'warn' : 'good',
      title: `${biggest.bucket.name} ${up ? 'up' : 'down'} ${percent(biggest.change!)}`,
      body: `Last cycle you spent ${formatINR(biggest.latest)} on ${biggest.bucket.name.toLowerCase()}, ${up ? 'more' : 'less'} than your earlier average.`,
    })
  }

  const merchants = merchantStats(state, closed.map((r) => r.cycle), 1)
  if (merchants[0]) {
    const top = merchants[0]
    result.push({
      tone: 'calm',
      title: `${top.name} is your top merchant`,
      body: `${formatINR(top.total)} across ${top.count} payments (about ${formatINR(top.average)} each), ${percent(top.share)} of everyday spending over ${closed.length} cycles.`,
    })
  }

  const weekdays = weekdayPattern(closed)
  const weekTotal = weekdays.reduce((a, b) => a + b, 0)
  if (weekTotal > 0) {
    const weekend = weekdays[4] + weekdays[5] + weekdays[6]
    const peak = weekdays.indexOf(Math.max(...weekdays))
    result.push({
      tone: 'calm',
      title: `${WEEKDAYS[peak]} is your big day`,
      body: `Friday to Sunday carries ${percent(weekend / weekTotal)} of a typical week's everyday spending; ${WEEKDAYS[peak]} averages ${formatINR(weekdays[peak])}.`,
    })
  }

  if (closed.length) {
    const rate = closed.reduce((sum, r) => sum + r.savingsRate, 0) / closed.length
    const last = closed.at(-1)!
    result.push({
      tone: rate >= 0.2 ? 'good' : 'warn',
      title: `Keeping ${percent(rate)} of take-home`,
      body: `On average ${formatINR(wholeRupees(closed.reduce((s, r) => s + r.leftOver, 0) / closed.length))} a cycle stays in surplus and sinking funds. Last cycle: ${percent(last.savingsRate)}.`,
    })

    const payments = closed.flatMap((r) => r.payments)
    const late = payments.filter((p) => p.status === 'late' || p.status === 'missed')
    if (payments.length) {
      result.push({
        tone: late.length ? 'warn' : 'good',
        title: late.length ? `${late.length} late ${late.length === 1 ? 'payment' : 'payments'}` : 'Every commitment on time',
        body: late.length
          ? `${[...new Set(late.map((p) => names.get(p.bucketId)))].join(', ')} went past ${late.length === 1 ? 'its' : 'their'} due window. ${payments.length - late.length} of ${payments.length} were on time.`
          : `${payments.length} committed payments across ${closed.length} cycles, all inside their due windows.`,
      })
    }
  }

  return result
}
