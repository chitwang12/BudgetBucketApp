import { useState } from 'react'
import { parseRupees, type Paise } from '../core/index.ts'

function toText(value: Paise): string {
  if (value === 0) return ''
  return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2)
}

/** Rupee entry that keeps the numeric keypad on iPhone and never triggers input zoom. */
export function MoneyInput({
  value,
  onChange,
  size = 'md',
  label,
  autoFocus,
}: {
  value: Paise
  onChange: (value: Paise) => void
  size?: 'md' | 'lg'
  label: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState(() => toText(value))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if ((parseRupees(text) ?? 0) !== value) setText(toText(value))
  }

  return (
    <label className={`money-input money-input--${size}`}>
      <span className="money-input__symbol" aria-hidden="true">
        ₹
      </span>
      <input
        aria-label={label}
        inputMode="decimal"
        enterKeyHint="done"
        placeholder="0"
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.]/g, '')
          setText(next)
          onChange(parseRupees(next) ?? 0)
        }}
      />
    </label>
  )
}
