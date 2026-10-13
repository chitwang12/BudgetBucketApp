import { createContext, useContext } from 'react'

export interface Sheets {
  openBucket: (bucketId: string) => void
  openTransaction: (txnId: string) => void
  openAdd: (bucketId: string | null) => void
  toast: (message: string) => void
}

export const SheetsContext = createContext<Sheets | null>(null)

export function useSheets(): Sheets {
  const sheets = useContext(SheetsContext)
  if (!sheets) throw new Error('useSheets must be used inside SheetsContext')
  return sheets
}
