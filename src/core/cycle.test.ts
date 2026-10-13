import { describe, expect, it } from 'vitest'
import {
  cycleContaining,
  cycleForSalaryDate,
  cycleStartsUntil,
  daysLeftInCycle,
  dueWindowInCycle,
} from './cycle.ts'
import { dateInZone } from './dates.ts'

describe('salary cycle', () => {
  it('runs from the start day to the day before the next one', () => {
    expect(cycleContaining('2026-10-13', 5)).toEqual({ start: '2026-10-05', end: '2026-11-04' })
    expect(cycleContaining('2026-10-04', 5)).toEqual({ start: '2026-09-05', end: '2026-10-04' })
    expect(cycleContaining('2026-12-20', 5)).toEqual({ start: '2026-12-05', end: '2027-01-04' })
  })

  it('clamps start days that a month does not have', () => {
    expect(cycleContaining('2027-02-15', 31)).toEqual({ start: '2027-01-31', end: '2027-02-27' })
    expect(cycleContaining('2027-02-28', 31)).toEqual({ start: '2027-02-28', end: '2027-03-30' })
  })

  it('opens on the actual salary date even when salary is early or late', () => {
    expect(cycleForSalaryDate('2026-10-03', 5)).toEqual({ start: '2026-10-03', end: '2026-11-04' })
    expect(cycleForSalaryDate('2026-10-07', 5)).toEqual({ start: '2026-10-07', end: '2026-11-04' })
  })

  it('counts today in the days left', () => {
    const cycle = { start: '2026-10-05', end: '2026-11-04' }
    expect(daysLeftInCycle('2026-10-05', cycle)).toBe(31)
    expect(daysLeftInCycle('2026-11-04', cycle)).toBe(1)
    expect(daysLeftInCycle('2026-11-05', cycle)).toBe(0)
  })

  it('places due windows on the right side of the month boundary', () => {
    const cycle = { start: '2026-10-05', end: '2026-11-04' }
    expect(dueWindowInCycle({ startDay: 1, endDay: 3 }, cycle)).toEqual({ start: '2026-11-01', end: '2026-11-03' })
    expect(dueWindowInCycle({ startDay: 7, endDay: 7 }, cycle)).toEqual({ start: '2026-10-07', end: '2026-10-07' })
    expect(dueWindowInCycle({ startDay: 28, endDay: 2 }, cycle)).toEqual({ start: '2026-10-28', end: '2026-11-02' })
  })

  it('counts cycle starts up to a due date', () => {
    expect(cycleStartsUntil('2026-11-05', '2027-10-10', 5)).toBe(12)
    expect(cycleStartsUntil('2026-10-05', '2026-10-10', 5)).toBe(1)
    expect(cycleStartsUntil('2026-10-05', '2026-01-01', 5)).toBe(1)
  })

  it('reads the calendar date in India time', () => {
    expect(dateInZone(new Date('2026-10-13T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-14')
  })
})
