import { rupees } from './money.ts'
import type { Bucket } from './types.ts'

export function bucket(overrides: Partial<Bucket> & Pick<Bucket, 'id' | 'type'>): Bucket {
  return {
    name: overrides.id,
    monthlyAmount: 0,
    dueWindow: null,
    amountTolerance: 0,
    target: null,
    targetDueDate: null,
    instalmentsRemaining: null,
    isBuffer: false,
    ...overrides,
  }
}

/** The dummy ₹50,000 plan from the product brief. */
export const examplePlan: Bucket[] = [
  bucket({ id: 'rent', type: 'committed', monthlyAmount: rupees(12_000), dueWindow: { startDay: 1, endDay: 3 } }),
  bucket({ id: 'family', type: 'committed', monthlyAmount: rupees(5_000) }),
  bucket({ id: 'sip', type: 'committed', monthlyAmount: rupees(5_000), dueWindow: { startDay: 7, endDay: 7 } }),
  bucket({
    id: 'emi',
    type: 'committed',
    monthlyAmount: rupees(3_000),
    dueWindow: { startDay: 3, endDay: 3 },
    instalmentsRemaining: 10,
  }),
  bucket({ id: 'internet', type: 'committed', monthlyAmount: rupees(1_000) }),
  bucket({ id: 'electricity', type: 'bill', monthlyAmount: rupees(1_000) }),
  bucket({ id: 'insurance', type: 'sinking', target: rupees(18_000), targetDueDate: '2027-10-10' }),
  bucket({ id: 'groceries', type: 'flexible', monthlyAmount: rupees(4_000) }),
  bucket({ id: 'fuel', type: 'flexible', monthlyAmount: rupees(2_000) }),
  bucket({ id: 'eating_out', type: 'flexible', monthlyAmount: rupees(1_500) }),
  bucket({ id: 'misc', type: 'flexible', monthlyAmount: rupees(1_000) }),
  bucket({ id: 'card', type: 'card', monthlyAmount: rupees(5_000), dueWindow: { startDay: 12, endDay: 12 } }),
  bucket({ id: 'emergency', type: 'surplus', monthlyAmount: rupees(4_000) }),
  bucket({ id: 'goals', type: 'surplus', monthlyAmount: rupees(3_000) }),
  bucket({ id: 'buffer', type: 'surplus', monthlyAmount: rupees(1_000), isBuffer: true }),
]
