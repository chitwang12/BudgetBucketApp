import { parseRupees, type Paise } from './money.ts'

export type Instrument = 'upi' | 'card' | 'netbanking' | 'neft' | 'imps' | 'atm' | 'other'
export type Direction = 'debit' | 'credit'

export type ParsedSms =
  | {
      kind: 'transaction'
      amount: Paise
      direction: Direction
      merchantRaw: string | null
      last4: string | null
      instrument: Instrument
    }
  | { kind: 'bill'; amount: Paise; merchantRaw: string | null }
  | { kind: 'ignore'; reason: string }

const IGNORE = /\b(otp|one[- ]time password|verification code|do not share|pre-?approved|offer|apply now|congratulations|reward points?)\b/i
const BILL = /\b(bill (?:amount|amt)|amount due|amt due|total due|bill (?:of|for)|is due on|due date)\b/i
const CURRENCY_AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi
const BARE_AMOUNT = /\b(?:debited|credited)\s+(?:by|with|for)?\s*([\d,]+(?:\.\d{1,2})?)/i
const NOT_THE_AMOUNT = /(?:bal(?:ance)?|limit|avl\.?)[\s:.-]*(?:is\s*)?$/i
const DEBIT = /\b(debited|spent|sent|paid|withdrawn|purchase|debit|txn)\b/i
const CREDIT = /\b(credited|received|deposited|refund(?:ed)?|reversed|reversal|a credit)\b/i
// Digits must stand alone, so a full account number never yields a false last 4.
const LAST4 = /(?:a\/c|acct|account|card)\s*(?:no\.?\s*)?(?:ending\s*(?:with\s*|in\s*)?)?[x*•]*\s*(\d{4})\b/i

const MERCHANT_PATTERNS = [
  /\b(?:vpa|upi id)\s+([\w.-]+@[\w-]+(?:\.[\w-]+)*)/i,
  /\b(?:to|at|towards|trf to)\s+(?:vpa\s+)?([A-Za-z0-9@&'._ -]{2,40}?)(?=\s+(?:on|ref|refno|upi|via|avl|not|dated|from|is|by|credited|debited)\b|[.,;:]|\s*$)/i,
  /\bon\s+([A-Z][A-Z0-9&'._ -]{2,40}?)(?=[.,;]|\s+(?:avl|ref)\b|\s*$)/,
  /\bIST\s+([A-Z][A-Z0-9&'._ -]{2,40}?)(?=\s+avl\b)/i,
  /\bfrom\s+(?:vpa\s+)?([A-Za-z0-9@&'._ -]{2,40}?)(?=\s+(?:on|ref|refno|upi|via|avl|credited|debited|as)\b|[.,;:]|\s*$)/i,
  /\bby\s+(?!(?:neft|imps|rtgs|upi|you)\b)([A-Za-z][A-Za-z0-9&'._ -]{2,40}?)(?=\s+(?:on|ref|avl)\b|[.,;]|\s*$)/i,
]

function firstAmount(text: string): Paise | null {
  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 20), match.index)
    if (NOT_THE_AMOUNT.test(before)) continue
    const amount = parseRupees(match[1])
    if (amount) return amount
  }
  const bare = BARE_AMOUNT.exec(text)
  return bare ? parseRupees(bare[1]) : null
}

function direction(text: string): Direction | null {
  const debit = DEBIT.exec(text)
  const credit = CREDIT.exec(text)
  if (debit && credit) return debit.index <= credit.index ? 'debit' : 'credit'
  return debit ? 'debit' : credit ? 'credit' : null
}

function merchant(text: string): string | null {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = pattern.exec(text)
    const name = match?.[1]?.replace(/\s+/g, ' ').trim()
    // Skip your own account or card ("ICICI Bank Card XX9876"), which banks also write after "to".
    if (name && !/^(?:(?:your|a\/c|ac|account|card)\b|x{2,})|\b(?:a\/c|acct|account|card)\b/i.test(name)) return name
  }
  return null
}

function instrument(text: string): Instrument {
  if (/\b(upi|vpa)\b|@[a-z]/i.test(text)) return 'upi'
  if (/\batm\b|withdrawn/i.test(text)) return 'atm'
  if (/\bcard\b/i.test(text)) return 'card'
  if (/\bneft\b/i.test(text)) return 'neft'
  if (/\bimps\b/i.test(text)) return 'imps'
  if (/net ?banking/i.test(text)) return 'netbanking'
  return 'other'
}

/** Reads amount, direction, merchant and account from an Indian bank SMS. Amounts only ever come from here. */
export function parseSms(text: string): ParsedSms {
  if (IGNORE.test(text)) return { kind: 'ignore', reason: 'Not a transaction' }
  const amount = firstAmount(text)
  if (!amount) return { kind: 'ignore', reason: 'No amount found' }
  const dir = direction(text)
  if (!dir) {
    return BILL.test(text) ? { kind: 'bill', amount, merchantRaw: merchant(text) } : { kind: 'ignore', reason: 'No debit or credit' }
  }
  return {
    kind: 'transaction',
    amount,
    direction: dir,
    merchantRaw: merchant(text),
    last4: LAST4.exec(text)?.[1] ?? null,
    instrument: instrument(text),
  }
}

/** Removes account and card digits and balances before the text is stored or sent anywhere. */
export function redactSms(text: string): string {
  return text
    .replace(/((?:a\/c|acct|account|card)\s*(?:no\.?\s*)?(?:ending\s*(?:with\s*)?)?)[x*•]*\s*\d{3,}/gi, '$1XX••••')
    .replace(
      /((?:avl\.?\s*bal(?:ance)?|available balance|available limit|avl\.?\s*limit|bal(?:ance)?)\s*(?:is\s*)?[:.-]?\s*)(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?/gi,
      '$1[hidden]',
    )
}

/** Stable fingerprint for dedupe: the same text received in the same minute is the same message. */
export function smsFingerprint(text: string, receivedAt: string): string {
  const input = `${text.trim()}|${receivedAt.slice(0, 16)}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
