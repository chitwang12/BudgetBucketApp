import { useState } from 'react'
import { BackIcon, PlusIcon } from '../components/Icons.tsx'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Eyebrow, Money, Sheet } from '../components/ui.tsx'
import { dateInZone, rupees, sum } from '../core/index.ts'
import { accountInUse, cardOwed } from '../data/operations.ts'
import { useStore } from '../data/store.tsx'
import type { Account, AccountKind } from '../data/types.ts'
import { navigate } from '../lib/router.ts'
import { useSheets } from '../lib/sheets.tsx'

const kindLabels: Record<AccountKind, string> = { bank: 'Bank accounts', card: 'Credit cards', wallet: 'Wallets', cash: 'Cash' }
const kindSingular: Record<AccountKind, string> = { bank: 'Bank account', card: 'Credit card', wallet: 'Wallet', cash: 'Cash' }
const KINDS: AccountKind[] = ['bank', 'card', 'wallet', 'cash']

export function Accounts() {
  const { state } = useStore()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const active = state.accounts.filter((a) => a.active)
  const archived = state.accounts.filter((a) => !a.active)

  return (
    <div className="screen">
      <button className="back" onClick={() => navigate('/settings')}>
        <BackIcon /> Settings
      </button>
      <div className="page-header page-header--flush">
        <div>
          <Eyebrow>Where money lives</Eyebrow>
          <h1 className="display">Accounts</h1>
        </div>
        <button className="round-button" aria-label="Add account" onClick={() => setEditing('new')}>
          <PlusIcon />
        </button>
      </div>

      {KINDS.map((kind) => {
        const list = active.filter((a) => a.kind === kind)
        if (list.length === 0) return null
        return (
          <section key={kind} className="account-section">
            <Eyebrow>{kindLabels[kind]}</Eyebrow>
            <div className="account-grid">
              {list.map((account) => (
                <AccountTile key={account.id} account={account} onOpen={() => setEditing(account.id)} />
              ))}
            </div>
          </section>
        )
      })}

      <button className="add-tile" onClick={() => setEditing('new')}>
        <PlusIcon />
        <span>Add a bank account, card or wallet</span>
      </button>

      {archived.length > 0 && (
        <section className="account-section">
          <Eyebrow>Archived</Eyebrow>
          <div className="card list">
            {archived.map((account) => (
              <button key={account.id} className="activity activity--tap" onClick={() => setEditing(account.id)}>
                <span className="activity__merchant">{account.name}</span>
                <span className="activity__meta mono">{account.last4 ? `••${account.last4}` : account.kind}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {editing && <AccountSheet key={editing} accountId={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AccountTile({ account, onOpen }: { account: Account; onOpen: () => void }) {
  const { state } = useStore()
  const card = state.buckets.find((b) => b.cardAccountId === account.id)
  const thisCycle = state.transactions.filter(
    (t) =>
      t.accountId === account.id &&
      t.direction === 'debit' &&
      t.status !== 'ignored' &&
      dateInZone(new Date(t.occurredAt), state.settings.timezone) >= state.cycle.start,
  )
  const spent = sum(thisCycle.map((t) => t.amount))

  return (
    <button className={`account-tile account-tile--${account.kind}`} onClick={onOpen}>
      <span className="account-tile__top">
        <span className="account-tile__kind">{kindSingular[account.kind]}</span>
        {account.kind === 'card' && <span className="account-tile__chip" aria-hidden="true" />}
      </span>
      <span className="account-tile__name">{account.name}</span>
      <span className="account-tile__bottom">
        <span className="account-tile__digits">{account.last4 ? `•••• ${account.last4}` : '—'}</span>
        <span className="account-tile__stat">
          {card ? (
            <>
              Owed <Money value={cardOwed(state, card)} />
            </>
          ) : (
            <>
              Out <Money value={spent} />
            </>
          )}
        </span>
      </span>
    </button>
  )
}

function AccountSheet({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const { state, addAccount, updateAccount, removeAccount } = useStore()
  const { toast } = useSheets()
  const existing = state.accounts.find((a) => a.id === accountId)
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'bank')
  const [name, setName] = useState(existing?.name ?? '')
  const [last4, setLast4] = useState(existing?.last4 ?? '')
  const [reserve, setReserve] = useState(rupees(2_000))
  const [billDay, setBillDay] = useState(15)
  const inUse = existing ? accountInUse(state, existing.id) : false
  const needsDigits = kind !== 'cash'
  const valid = name.trim().length > 0 && (!needsDigits || /^\d{4}$/.test(last4) || last4 === '')

  const save = () => {
    if (!valid) return
    const digits = /^\d{4}$/.test(last4) ? last4 : null
    if (existing) {
      updateAccount(existing.id, { name: name.trim(), last4: digits })
      toast('Account updated')
    } else {
      addAccount({ name, kind, last4: digits, card: kind === 'card' ? { monthlyReserve: reserve, billDay } : undefined })
      toast(kind === 'card' ? 'Card added with its bill bucket' : 'Account added')
    }
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={existing ? existing.name : 'New account'}>
      {!existing && (
        <div className="segmented" role="radiogroup">
          {KINDS.map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`segmented__option ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>
              {k === 'bank' ? 'Bank' : k === 'card' ? 'Card' : k === 'wallet' ? 'Wallet' : 'Cash'}
            </button>
          ))}
        </div>
      )}

      <label className="field">
        <Eyebrow>Name</Eyebrow>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'card' ? 'e.g. HDFC Millennia' : kind === 'wallet' ? 'e.g. Paytm wallet' : 'e.g. Axis Savings'}
        />
      </label>

      {needsDigits && (
        <label className="field">
          <Eyebrow>Last 4 digits</Eyebrow>
          <input
            className="text-input mono"
            inputMode="numeric"
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="1234"
          />
          <span className="field__hint">Matches bank SMS like “A/c XX1234” to this account. Only the last four digits are kept.</span>
        </label>
      )}

      {!existing && kind === 'card' && (
        <div className="card edit-card">
          <Eyebrow>Card bill bucket</Eyebrow>
          <p className="muted">Categorised swipes move money in automatically. This reserve covers spends you leave uncategorised.</p>
          <MoneyInput value={reserve} onChange={setReserve} size="lg" label="Monthly reserve" />
          <label className="field">
            <Eyebrow>Bill due on day</Eyebrow>
            <input className="text-input" inputMode="numeric" value={billDay || ''} onChange={(e) => setBillDay(Math.min(31, Number(e.target.value.replace(/\D/g, '')) || 0))} />
          </label>
        </div>
      )}

      <button className="button button--ink button--block" disabled={!valid || (kind === 'card' && !existing && billDay < 1)} onClick={save}>
        {existing ? 'Save' : 'Add account'}
      </button>

      {existing && (
        <>
          {existing.active ? (
            <button
              className="button button--danger button--block"
              onClick={() => {
                removeAccount(existing.id)
                toast(inUse ? 'Archived — history kept' : 'Account removed')
                onClose()
              }}
            >
              {inUse ? 'Archive account' : 'Remove account'}
            </button>
          ) : (
            <button
              className="button button--ghost button--block"
              onClick={() => {
                updateAccount(existing.id, { active: true })
                toast('Account restored')
                onClose()
              }}
            >
              Restore account
            </button>
          )}
          {inUse && existing.active && <p className="fineprint">This account has transactions, so it's archived rather than deleted.</p>}
        </>
      )}
    </Sheet>
  )
}
