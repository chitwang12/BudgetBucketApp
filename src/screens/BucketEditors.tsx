import { useState } from 'react'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Eyebrow, Sheet, Toggle } from '../components/ui.tsx'
import { formatINR, sinkingContribution, type IsoDate, type Paise } from '../core/index.ts'
import { balanceOfBucket, bucketInUse, bufferBucket, canRemoveBucket, type NewBucketType } from '../data/operations.ts'
import { useStore } from '../data/store.tsx'
import type { Tone } from '../data/types.ts'
import { useSheets } from '../lib/sheets.tsx'

const KINDS: { type: NewBucketType; title: string; hint: string; placeholder: string }[] = [
  { type: 'flexible', title: 'Everyday spend', hint: 'A monthly limit, like Groceries', placeholder: 'e.g. Pet care' },
  { type: 'committed', title: 'Fixed payment', hint: 'Same amount each month, like Rent or an EMI', placeholder: 'e.g. Gym membership' },
  { type: 'bill', title: 'Bill', hint: 'The amount changes, like electricity', placeholder: 'e.g. Water bill' },
  { type: 'sinking', title: 'Saving towards', hint: 'A target by a date, like an insurance premium', placeholder: 'e.g. New phone' },
  { type: 'surplus', title: 'Savings pot', hint: 'Money you keep, like an emergency fund', placeholder: 'e.g. Wedding fund' },
]

const TONES: Tone[] = ['mango', 'forest', 'teal', 'sun', 'blush', 'ink']

const parseKeywords = (text: string) =>
  text
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

function DueDays({ start, end, onStart, onEnd }: { start: number; end: number; onStart: (d: number) => void; onEnd: (d: number) => void }) {
  const day = (value: string) => Math.min(31, Number(value.replace(/\D/g, '')) || 0)
  return (
    <div className="field-row">
      <label className="field">
        <Eyebrow>Due from day</Eyebrow>
        <input className="text-input" inputMode="numeric" value={start || ''} placeholder="1" onChange={(e) => onStart(day(e.target.value))} />
      </label>
      <label className="field">
        <Eyebrow>To day</Eyebrow>
        <input className="text-input" inputMode="numeric" value={end || ''} placeholder="same day" onChange={(e) => onEnd(day(e.target.value))} />
      </label>
    </div>
  )
}

function GroupChips({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { state } = useStore()
  return (
    <div className="chips">
      {state.groups.map((g) => (
        <button key={g.id} className={`chip ${value === g.id ? 'is-active' : ''}`} aria-pressed={value === g.id} onClick={() => onChange(g.id)}>
          {g.name}
        </button>
      ))}
    </div>
  )
}

export function AddBucketSheet({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { state, today, addBucket } = useStore()
  const { toast } = useSheets()
  const groupTypes = state.buckets.filter((b) => b.groupId === groupId).map((b) => b.type)
  const [type, setType] = useState<NewBucketType>(KINDS.find((k) => groupTypes.includes(k.type))?.type ?? 'flexible')
  const [name, setName] = useState('')
  const [group, setGroup] = useState(groupId)
  const [amount, setAmount] = useState<Paise>(0)
  const [targetDate, setTargetDate] = useState<IsoDate | ''>('')
  const [startDay, setStartDay] = useState(0)
  const [endDay, setEndDay] = useState(0)
  const [keywords, setKeywords] = useState('')
  const [fund, setFund] = useState(true)
  const [fundAmount, setFundAmount] = useState<Paise | null>(null)

  const kind = KINDS.find((k) => k.type === type)!
  const buffer = bufferBucket(state)
  const bufferBalance = buffer ? balanceOfBucket(state, buffer.id) : 0
  const isGoal = type === 'sinking'
  const needsDue = type === 'committed' || type === 'bill'
  const goalValid = isGoal && targetDate !== '' && targetDate > today
  const suggested =
    isGoal && goalValid
      ? sinkingContribution({ target: amount, balance: 0, cycleStart: state.cycle.start, dueDate: targetDate, cycleStartDay: state.settings.cycleStartDay })
      : isGoal
        ? 0
        : amount
  const funding = fund && buffer ? (fundAmount ?? suggested) : 0
  const valid = name.trim().length > 0 && amount > 0 && (!isGoal || goalValid) && (!needsDue || startDay > 0)

  const save = () => {
    if (!valid) return
    addBucket(
      {
        name,
        groupId: group,
        type,
        monthlyAmount: amount,
        dueWindow: needsDue ? { startDay, endDay: Math.max(startDay, endDay || startDay) } : null,
        target: isGoal ? amount : null,
        targetDueDate: isGoal ? (targetDate as IsoDate) : null,
        matchKeywords: parseKeywords(keywords),
      },
      funding,
    )
    toast(funding > 0 ? `${name.trim()} added with ${formatINR(funding)}` : `${name.trim()} added`)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title="New bucket">
      <div className="kind-list" role="radiogroup">
        {KINDS.map((k) => (
          <button key={k.type} role="radio" aria-checked={type === k.type} className={`kind ${type === k.type ? 'is-active' : ''}`} onClick={() => setType(k.type)}>
            <span className="kind__title">{k.title}</span>
            <span className="kind__hint">{k.hint}</span>
          </button>
        ))}
      </div>

      <label className="field">
        <Eyebrow>Name</Eyebrow>
        <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind.placeholder} />
      </label>

      <Eyebrow>{isGoal ? 'Target' : type === 'bill' ? 'Usual amount a month' : 'Monthly amount'}</Eyebrow>
      <MoneyInput value={amount} onChange={setAmount} size="lg" label="Amount" />

      {isGoal && (
        <label className="field">
          <Eyebrow>Needed by</Eyebrow>
          <input className="text-input" type="date" min={today} value={targetDate} onChange={(e) => setTargetDate(e.target.value as IsoDate)} />
          {goalValid && amount > 0 && <span className="field__hint">About {formatINR(suggested)} a month gets you there.</span>}
        </label>
      )}

      {needsDue && <DueDays start={startDay} end={endDay} onStart={setStartDay} onEnd={setEndDay} />}

      <Eyebrow>Group</Eyebrow>
      <GroupChips value={group} onChange={setGroup} />

      {type !== 'flexible' && type !== 'surplus' && (
        <label className="field">
          <Eyebrow>Words in the bank SMS (optional)</Eyebrow>
          <input className="text-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. cult.fit, gym" />
          <span className="field__hint">Separate with commas. A payment mentioning these goes straight to this bucket.</span>
        </label>
      )}

      {buffer && (
        <div className="card edit-card">
          <Toggle
            checked={fund}
            onChange={setFund}
            label={
              <span>
                <span className="settings-row__title">Fund it now from {buffer.name}</span>
                <span className="activity__meta">
                  {buffer.name} has {formatINR(bufferBalance)}. Otherwise it starts at ₹0 until salary day.
                </span>
              </span>
            }
          />
          {fund && (
            <>
              <MoneyInput value={funding} onChange={setFundAmount} label="Amount to move from the buffer" />
              {funding > bufferBalance && <p className="field__hint field__hint--warn">{buffer.name} will go {formatINR(bufferBalance - funding)}.</p>}
            </>
          )}
        </div>
      )}

      <button className="button button--ink button--block" disabled={!valid} onClick={save}>
        Add bucket
      </button>
    </Sheet>
  )
}

export function EditBucketSheet({ bucketId, onClose }: { bucketId: string; onClose: () => void }) {
  const { state, updateBucket, removeBucket } = useStore()
  const { toast } = useSheets()
  const bucket = state.buckets.find((b) => b.id === bucketId)
  const [name, setName] = useState(bucket?.name ?? '')
  const [group, setGroup] = useState(bucket?.groupId ?? '')
  const [amount, setAmount] = useState(bucket?.type === 'sinking' ? (bucket.target ?? 0) : (bucket?.monthlyAmount ?? 0))
  const [keywords, setKeywords] = useState(bucket?.matchKeywords.join(', ') ?? '')
  const [startDay, setStartDay] = useState(bucket?.dueWindow?.startDay ?? 0)
  const [endDay, setEndDay] = useState(bucket?.dueWindow?.endDay ?? 0)
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (!bucket) return null

  const hasWindow = ['committed', 'bill', 'card'].includes(bucket.type)
  const balance = balanceOfBucket(state, bucket.id)
  const keeps = bucketInUse(state, bucket.id)
  const buffer = bufferBucket(state)

  const save = () => {
    updateBucket(bucket.id, {
      name: name.trim() || bucket.name,
      groupId: group,
      ...(bucket.type === 'sinking' ? { target: amount } : { monthlyAmount: amount }),
      matchKeywords: parseKeywords(keywords),
      dueWindow: hasWindow && startDay > 0 ? { startDay, endDay: Math.max(startDay, endDay || startDay) } : bucket.dueWindow,
    })
    toast('Bucket saved')
    onClose()
  }

  const remove = () => {
    removeBucket(bucket.id)
    toast(keeps ? `${bucket.name} archived` : `${bucket.name} removed`)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={bucket.name}>
      <label className="field">
        <Eyebrow>Name</Eyebrow>
        <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <Eyebrow>{bucket.type === 'sinking' ? 'Target' : 'Monthly amount'}</Eyebrow>
      <MoneyInput value={amount} onChange={setAmount} size="lg" label="Amount" />
      {hasWindow && <DueDays start={startDay} end={endDay} onStart={setStartDay} onEnd={setEndDay} />}
      <Eyebrow>Group</Eyebrow>
      <GroupChips value={group} onChange={setGroup} />
      {bucket.type !== 'flexible' && bucket.type !== 'surplus' && (
        <label className="field">
          <Eyebrow>SMS keywords</Eyebrow>
          <input className="text-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="landlord, rent" />
        </label>
      )}
      <button className="button button--ink button--block" onClick={save}>
        Save
      </button>

      {canRemoveBucket(bucket) ? (
        confirmRemove ? (
          <div className="callout callout--bad">
            <p>
              {balance > 0 && `${formatINR(balance)} goes back to ${buffer?.name ?? 'the buffer'}. `}
              {balance < 0 && `${buffer?.name ?? 'The buffer'} covers the ${formatINR(-balance)} overspend. `}
              {keeps ? 'Its past spending stays in Activity and Insights; you can restore it from Plan.' : 'It has no history, so it is deleted.'}
            </p>
            <div className="button-row">
              <button className="button button--danger-fill button--small" onClick={remove}>
                {keeps ? 'Archive' : 'Delete'}
              </button>
              <button className="button button--ghost button--small" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button className="button button--danger button--block button--flush" onClick={() => setConfirmRemove(true)}>
            Remove bucket
          </button>
        )
      ) : (
        <p className="fineprint">
          {bucket.isBuffer ? 'The buffer covers overspends, so it always stays.' : 'Card bill buckets go when you remove the card in Accounts & cards.'}
        </p>
      )}
    </Sheet>
  )
}

export function GroupSheet({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  const { state, addGroup, updateGroup, moveGroup, removeGroup } = useStore()
  const { toast } = useSheets()
  const existing = state.groups.find((g) => g.id === groupId)
  const [name, setName] = useState(existing?.name ?? '')
  const [tone, setTone] = useState<Tone>(existing?.tone ?? 'mango')
  const index = existing ? state.groups.indexOf(existing) : -1
  const bucketCount = existing ? state.buckets.filter((b) => b.groupId === existing.id).length : 0

  const save = () => {
    if (!name.trim()) return
    if (existing) {
      updateGroup(existing.id, { name, tone })
      toast('Group saved')
    } else {
      addGroup(name, tone)
      toast(`${name.trim()} added`)
    }
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={existing ? existing.name : 'New group'}>
      <label className="field">
        <Eyebrow>Name</Eyebrow>
        <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kids" />
      </label>
      <Eyebrow>Colour</Eyebrow>
      <div className="swatches" role="radiogroup">
        {TONES.map((t) => (
          <button key={t} role="radio" aria-checked={tone === t} aria-label={t} className={`swatch tone--${t} ${tone === t ? 'is-active' : ''}`} onClick={() => setTone(t)} />
        ))}
      </div>

      {existing && (
        <>
          <Eyebrow>Position on Home and Plan</Eyebrow>
          <div className="button-row">
            <button className="button button--ghost button--small" disabled={index <= 0} onClick={() => moveGroup(existing.id, -1)}>
              Move up
            </button>
            <button className="button button--ghost button--small" disabled={index >= state.groups.length - 1} onClick={() => moveGroup(existing.id, 1)}>
              Move down
            </button>
          </div>
        </>
      )}

      <button className="button button--ink button--block" disabled={!name.trim()} onClick={save}>
        {existing ? 'Save' : 'Add group'}
      </button>

      {existing &&
        (bucketCount === 0 ? (
          <button
            className="button button--danger button--block button--flush"
            onClick={() => {
              removeGroup(existing.id)
              toast(`${existing.name} removed`)
              onClose()
            }}
          >
            Delete group
          </button>
        ) : (
          <p className="fineprint">
            Move or remove its {bucketCount} {bucketCount === 1 ? 'bucket' : 'buckets'} to delete this group.
          </p>
        ))}
    </Sheet>
  )
}
