import type { ReactNode } from 'react'
import { useStore } from '../data/store.tsx'
import type { Group } from '../data/types.ts'
import type { Mood } from '../data/selectors.ts'
import { Money } from './ui.tsx'

/** A bucket group whose rows fold away; the open/closed state is remembered per group. */
export function GroupSection({
  group,
  total,
  moods = [],
  count,
  children,
}: {
  group: Group
  total?: number
  moods?: Mood[]
  count: number
  children: ReactNode
}) {
  const { state, toggleGroup } = useStore()
  const collapsed = state.ui.collapsedGroups.includes(group.id)
  const alerts = moods.filter((m) => m === 'bad').length
  const warnings = moods.filter((m) => m === 'warn').length

  return (
    <section className={`group tone--${group.tone} ${collapsed ? 'is-collapsed' : ''}`}>
      <button className="group__header group__toggle" aria-expanded={!collapsed} onClick={() => toggleGroup(group.id)}>
        <h2 className="display display--sm">
          <span className="group__dot" />
          {group.name}
        </h2>
        <span className="group__side">
          {collapsed && (
            <span className="group__summary">
              {count} {count === 1 ? 'bucket' : 'buckets'}
              {alerts > 0 && <span className="group__flag group__flag--bad">{alerts}</span>}
              {warnings > 0 && <span className="group__flag group__flag--warn">{warnings}</span>}
            </span>
          )}
          {total !== undefined && <Money value={total} className="group__total" />}
          <span className="chevron" aria-hidden="true" />
        </span>
      </button>
      <div className="collapsible">
        <div className="collapsible__inner">{children}</div>
      </div>
    </section>
  )
}
