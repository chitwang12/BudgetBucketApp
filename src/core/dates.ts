/** Calendar date as 'YYYY-MM-DD'. Plain strings sort chronologically and carry no time zone. */
export type IsoDate = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseIsoDate(date: IsoDate): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(date)
  if (!match) throw new Error(`Invalid date: ${date}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function toUtcMs(date: IsoDate): number {
  const { y, m, d } = parseIsoDate(date)
  return Date.UTC(y, m - 1, d)
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + delta
  return { y: Math.floor(index / 12), m: (index % 12) + 1 }
}

/** Builds a date, clamping the day to the month's length (31 in February becomes 28 or 29). */
export function makeDate(y: number, m: number, day: number): IsoDate {
  const d = Math.min(day, daysInMonth(y, m))
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * 86_400_000)
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000)
}

/** The calendar date at `instant` in the given IANA time zone. */
export function dateInZone(instant: Date, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}
