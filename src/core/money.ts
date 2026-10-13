/** Money is always an integer number of paise (₹1 = 100 paise). */
export type Paise = number

export function rupees(amount: number): Paise {
  return Math.round(amount * 100)
}

/** Parses amounts like "1,23,456.50", "Rs.500", "INR 2,000" or "₹99.9". Returns null if there is no amount. */
export function parseRupees(text: string): Paise | null {
  const cleaned = text.replace(/(?:rs\.?|inr|₹)/gi, '').replace(/,/g, '').trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned)
  if (!match) return null
  const paise = match[2] ? Number(match[2].padEnd(2, '0')) : 0
  return Number(match[1]) * 100 + paise
}

const groupRupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** Formats with Indian digit grouping, e.g. ₹1,23,456 or −₹600.50. Paise are shown only when non-zero. */
export function formatINR(amount: Paise): string {
  const sign = amount < 0 ? '−' : ''
  const abs = Math.abs(amount)
  const whole = groupRupees.format(Math.floor(abs / 100))
  const fraction = abs % 100
  return `${sign}₹${whole}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`
}

export function sum(amounts: readonly Paise[]): Paise {
  return amounts.reduce((total, amount) => total + amount, 0)
}
