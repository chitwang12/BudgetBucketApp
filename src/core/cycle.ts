import { addDays, addMonths, diffDays, makeDate, parseIsoDate, type IsoDate } from './dates.ts'
import type { DueWindow } from './types.ts'

/** Inclusive date range of one salary cycle. */
export interface CycleBounds {
  start: IsoDate
  end: IsoDate
}

function nominalStart(y: number, m: number, startDay: number): IsoDate {
  return makeDate(y, m, startDay)
}

function nextNominalStart(after: IsoDate, startDay: number): IsoDate {
  const { y, m } = parseIsoDate(after)
  const sameMonth = nominalStart(y, m, startDay)
  if (sameMonth > after) return sameMonth
  const next = addMonths(y, m, 1)
  return nominalStart(next.y, next.m, startDay)
}

/** The planned cycle containing `date`, e.g. 5th to 4th for a start day of 5. */
export function cycleContaining(date: IsoDate, startDay: number): CycleBounds {
  const { y, m } = parseIsoDate(date)
  let start = nominalStart(y, m, startDay)
  if (date < start) {
    const prev = addMonths(y, m, -1)
    start = nominalStart(prev.y, prev.m, startDay)
  }
  return { start, end: addDays(nextNominalStart(start, startDay), -1) }
}

/**
 * Bounds for a cycle opened by a salary credit. Salary can land a few days early or late,
 * so the cycle starts on the actual credit date and ends before the planned start nearest
 * to one month later.
 */
export function cycleForSalaryDate(salaryDate: IsoDate, startDay: number): CycleBounds {
  const { y, m } = parseIsoDate(salaryDate)
  const candidates = [-1, 0, 1].map((delta) => {
    const month = addMonths(y, m, delta)
    return nominalStart(month.y, month.m, startDay)
  })
  const intended = candidates.reduce((best, candidate) =>
    Math.abs(diffDays(salaryDate, candidate)) < Math.abs(diffDays(salaryDate, best)) ? candidate : best,
  )
  return { start: salaryDate, end: addDays(nextNominalStart(intended, startDay), -1) }
}

/** Days left in the cycle, counting today. */
export function daysLeftInCycle(today: IsoDate, cycle: CycleBounds): number {
  return Math.max(0, diffDays(today, cycle.end) + 1)
}

/** The date inside the cycle that falls on `day` of the month; the cycle end if none does. */
export function dateForDayInCycle(day: number, cycle: CycleBounds): IsoDate {
  const { y, m } = parseIsoDate(cycle.start)
  for (let delta = 0; delta <= 2; delta++) {
    const month = addMonths(y, m, delta)
    const candidate = makeDate(month.y, month.m, day)
    if (candidate >= cycle.start && candidate <= cycle.end) return candidate
  }
  return cycle.end
}

export function dueWindowInCycle(window: DueWindow, cycle: CycleBounds): CycleBounds {
  const start = dateForDayInCycle(window.startDay, cycle)
  let end = dateForDayInCycle(window.endDay, cycle)
  if (end < start) {
    const span = (window.endDay - window.startDay + 31) % 31
    end = addDays(start, span) > cycle.end ? cycle.end : addDays(start, span)
  }
  return { start, end }
}

/** Number of cycle starts from `cycleStart` up to and including `until`; at least 1. */
export function cycleStartsUntil(cycleStart: IsoDate, until: IsoDate, startDay: number): number {
  let count = 1
  let next = nextNominalStart(cycleStart, startDay)
  while (next <= until) {
    count++
    next = nextNominalStart(next, startDay)
  }
  return count
}
