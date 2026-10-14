import { describe, expect, it } from 'vitest'
import { matchRule, normaliseMerchant } from './match.ts'
import { rupees } from './money.ts'
import { parseSms, redactSms, smsFingerprint } from './sms.ts'

describe('parseSms: SBI and credit cards', () => {
  const cases: [string, string, object][] = [
    [
      'SBI UPI debit',
      'Dear UPI user A/C X4321 debited by 250.0 on date 14Oct26 trf to SWIGGY Refno 428765123456. If not u? call 1800111109. -SBI',
      { amount: rupees(250), direction: 'debit', merchantRaw: 'SWIGGY', last4: '4321' },
    ],
    [
      'SBI transfer',
      'Your A/C XXXXX4321 Debited INR 1,200.00 on 14/10/26 -Transferred to Mr RAHUL KUMAR. Avl Balance INR 25,310.50-SBI',
      { amount: rupees(1_200), direction: 'debit', last4: '4321' },
    ],
    [
      'SBI salary credit',
      'Dear Customer, Your A/C XXXXX4321 has a credit by NEFT of Rs 50,000.00 on 14/10/26 by ACME TECHNOLOGIES. Avl Bal Rs 75,310.50-SBI',
      { amount: rupees(50_000), direction: 'credit', merchantRaw: 'ACME TECHNOLOGIES', last4: '4321' },
    ],
    [
      'SBI Card',
      'Rs.1,499.00 spent on your SBI Credit Card ending 5566 at AMAZON on 14/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
      { amount: rupees(1_499), direction: 'debit', merchantRaw: 'AMAZON', last4: '5566' },
    ],
    [
      'HDFC card, Txn wording',
      'Txn Rs.899.00 On HDFC Bank Card 7788 At MYNTRA by UPI 428712345678 On 14-10',
      { amount: rupees(899), direction: 'debit', merchantRaw: 'MYNTRA', last4: '7788' },
    ],
    [
      'Axis card',
      'Spent INR 750 Axis Bank Card no. XX2233 14-10-26 20:11:05 IST BLINKIT Avl Limit: INR 98,250',
      { amount: rupees(750), direction: 'debit', merchantRaw: 'BLINKIT', last4: '2233' },
    ],
  ]
  for (const [name, text, expected] of cases) {
    it(`reads ${name}`, () => expect(parseSms(text)).toMatchObject({ kind: 'transaction', ...expected }))
  }

  it('drops the full stop after a UPI id', () => {
    expect(parseSms('Rs 2,000.00 credited to A/c XX1234 from VPA rahul.k@okaxis. UPI Ref 1')).toMatchObject({ merchantRaw: 'rahul.k@okaxis' })
  })

  it('keeps merchants whose names start like "account"', () => {
    expect(parseSms('Rs 499 debited from A/c XX4321 to ACT FIBERNET on 14-10-26')).toMatchObject({ merchantRaw: 'ACT FIBERNET' })
  })

  it('never takes the last 4 from a full account number', () => {
    expect(parseSms('Rs 500 debited from account 123456789012 to VPA a@b')).toMatchObject({ last4: null })
  })

  it('ignores a card OTP', () => {
    expect(parseSms('428913 is the OTP for your SBI Card transaction of Rs 1,499.00 at AMAZON. Do not share.').kind).toBe('ignore')
  })
})

describe('parseSms', () => {
  it('reads a UPI debit', () => {
    expect(
      parseSms('Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY On 12/10/26 Ref 628712345678 Not You? Call 18002586161'),
    ).toEqual({
      kind: 'transaction',
      amount: rupees(450),
      direction: 'debit',
      merchantRaw: 'SWIGGY',
      last4: '1234',
      instrument: 'other',
    })
  })

  it('reads a card spend and skips the available limit', () => {
    const parsed = parseSms('INR 1,249.00 spent using ICICI Bank Card XX9876 on 12-Oct-26 on AMAZON PAY IN. Avl Limit: INR 85,000.00')
    expect(parsed).toMatchObject({ kind: 'transaction', amount: rupees(1_249), merchantRaw: 'AMAZON PAY IN', last4: '9876', instrument: 'card' })
  })

  it('reads an amount with no currency label', () => {
    const parsed = parseSms('Dear UPI user A/C X5678 debited by 2000.0 on date 11Oct26 trf to RAMESH KUMAR Refno 628812345678')
    expect(parsed).toMatchObject({ kind: 'transaction', amount: rupees(2_000), merchantRaw: 'RAMESH KUMAR', instrument: 'upi' })
  })

  it('reads a VPA as the merchant', () => {
    const parsed = parseSms('Rs 280 debited from A/c XX1234 to VPA paytm-4829@ybl on 13-10-26. UPI Ref 123456')
    expect(parsed).toMatchObject({ amount: rupees(280), merchantRaw: 'paytm-4829@ybl', instrument: 'upi' })
  })

  it('recognises a credit', () => {
    expect(parseSms('Rs.50,000.00 credited to A/c XX1234 on 05-10-26 by NEFT from ACME CORP. Avl Bal Rs 62,310.00')).toMatchObject({
      direction: 'credit',
      amount: rupees(50_000),
    })
  })

  it('recognises a bill notice', () => {
    expect(parseSms('BESCOM: Bill amount Rs 1,240.00 for Oct-26 is due on 18-10-26.')).toMatchObject({ kind: 'bill', amount: rupees(1_240) })
  })

  it('ignores OTPs and offers', () => {
    expect(parseSms('123456 is your OTP for a transaction of Rs 500 at AMAZON. Do not share.').kind).toBe('ignore')
    expect(parseSms('Congratulations! You are pre-approved for a loan of Rs 5,00,000').kind).toBe('ignore')
  })
})

describe('redactSms', () => {
  it('hides account digits and balances but keeps the amount', () => {
    expect(redactSms('Rs.500 debited from A/c XX1234. Avl Bal Rs 62,310.00')).toBe('Rs.500 debited from A/c XX••••. Avl Bal [hidden]')
    expect(redactSms('spent using ICICI Bank Card XX9876. Avl Limit: INR 85,000.00')).toBe(
      'spent using ICICI Bank Card XX••••. Avl Limit: [hidden]',
    )
  })
})

describe('matching', () => {
  it('normalises UPI handles and punctuation', () => {
    expect(normaliseMerchant('SWIGGY@icici')).toBe('swiggy')
    expect(normaliseMerchant('Bharat-Petroleum ')).toBe('bharat petroleum')
  })

  it('prefers the most specific rule', () => {
    const rules = [
      { id: '1', pattern: 'amazon', bucketId: 'misc' },
      { id: '2', pattern: 'amazon fresh', bucketId: 'groceries' },
    ]
    expect(matchRule(rules, 'AMAZON FRESH IN')?.bucketId).toBe('groceries')
    expect(matchRule(rules, 'AMAZON PAY')?.bucketId).toBe('misc')
    expect(matchRule(rules, 'ZOMATO')).toBeNull()
  })

  it('fingerprints the same message in the same minute identically', () => {
    expect(smsFingerprint('a', '2026-10-13T10:00:05Z')).toBe(smsFingerprint('a ', '2026-10-13T10:00:59Z'))
    expect(smsFingerprint('a', '2026-10-13T10:00:05Z')).not.toBe(smsFingerprint('a', '2026-10-13T10:01:00Z'))
  })
})
