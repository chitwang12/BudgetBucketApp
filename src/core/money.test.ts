import { describe, expect, it } from 'vitest'
import { formatINR, parseRupees, rupees } from './money.ts'

describe('money', () => {
  it('converts rupees to integer paise', () => {
    expect(rupees(18_000)).toBe(1_800_000)
    expect(rupees(0.1 + 0.2)).toBe(30)
  })

  it('parses bank-style amounts', () => {
    expect(parseRupees('Rs.1,23,456.50')).toBe(12_345_650)
    expect(parseRupees('INR 2,000')).toBe(200_000)
    expect(parseRupees('₹99.9')).toBe(9_990)
    expect(parseRupees('balance')).toBeNull()
  })

  it('formats with Indian grouping and a real minus sign', () => {
    expect(formatINR(12_345_650)).toBe('₹1,23,456.50')
    expect(formatINR(rupees(50_000))).toBe('₹50,000')
    expect(formatINR(-rupees(600))).toBe('−₹600')
    expect(formatINR(0)).toBe('₹0')
  })
})
