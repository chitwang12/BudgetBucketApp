import { useEffect, type ReactNode } from 'react'
import { formatINR, type Paise } from '../core/index.ts'
import type { Mood } from '../data/selectors.ts'

export function Money({ value, className = '' }: { value: Paise; className?: string }) {
  return <span className={`money ${value < 0 ? 'is-negative' : ''} ${className}`}>{formatINR(value)}</span>
}

export function Pill({ mood, children }: { mood: Mood; children: ReactNode }) {
  return <span className={`pill pill--${mood}`}>{children}</span>
}

export function Bar({ value, mood }: { value: number; mood: Mood }) {
  return (
    <div className="bar" aria-hidden="true">
      <div className={`bar__fill bar__fill--${mood}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>
}

export function PageHeader({ eyebrow, title, action }: { eyebrow: ReactNode; title: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="display">{title}</h1>
      </div>
      {action}
    </header>
  )
}

export function Marquee({ items }: { items: string[] }) {
  const line = items.map((item) => (
    <span key={item} className="marquee__item">
      {item}
      <span className="marquee__star">✦</span>
    </span>
  ))
  return (
    <div className="marquee" aria-label={items.join(', ')}>
      <div className="marquee__track" aria-hidden="true">
        <div className="marquee__group">{line}</div>
        <div className="marquee__group">{line}</div>
      </div>
    </div>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet__handle" />
        <header className="sheet__header">
          <h2 className="display display--sm">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </section>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={`segmented__option ${value === option.value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  )
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDone, 2600)
    return () => window.clearTimeout(timer)
  }, [message, onDone])
  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
