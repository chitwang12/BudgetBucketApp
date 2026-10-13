import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { HomeIcon, InboxIcon, InsightsIcon, PlanIcon, PlusIcon, TimelineIcon } from './components/Icons.tsx'
import { Toast } from './components/ui.tsx'
import { inboxItems } from './data/selectors.ts'
import { StoreProvider, useStore } from './data/store.tsx'
import { navigate, useRoute, type Route } from './lib/router.ts'
import { SheetsContext, type Sheets } from './lib/sheets.tsx'
import { Accounts } from './screens/Accounts.tsx'
import { Activity } from './screens/Activity.tsx'
import { AddTransactionSheet } from './screens/AddTransactionSheet.tsx'
import { Allocate } from './screens/Allocate.tsx'
import { BucketSheet } from './screens/BucketSheet.tsx'
import { Home } from './screens/Home.tsx'
import { Inbox } from './screens/Inbox.tsx'
import { Insights } from './screens/Insights.tsx'
import { Plan } from './screens/Plan.tsx'
import { Settings } from './screens/Settings.tsx'
import { SimulateSmsSheet } from './screens/SimulateSmsSheet.tsx'
import { Timeline } from './screens/Timeline.tsx'
import { TransactionSheet } from './screens/TransactionSheet.tsx'

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  { route: '/', label: 'Home', icon: <HomeIcon /> },
  { route: '/timeline', label: 'Timeline', icon: <TimelineIcon /> },
  { route: '/insights', label: 'Insights', icon: <InsightsIcon /> },
  { route: '/inbox', label: 'Inbox', icon: <InboxIcon /> },
  { route: '/plan', label: 'Plan', icon: <PlanIcon /> },
]

const TAB_FOR: Partial<Record<Route, Route>> = {
  '/plan/allocate': '/plan',
  '/activity': '/',
  '/settings': '/',
  '/accounts': '/',
}

function Shell() {
  const route = useRoute()
  const { state } = useStore()
  const [bucketId, setBucketId] = useState<string | null>(null)
  const [txnId, setTxnId] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ bucketId: string | null } | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const inboxCount = inboxItems(state).length
  const isAllocating = route === '/plan/allocate'
  const activeTab = TAB_FOR[route] ?? route

  const sheets = useMemo<Sheets>(
    () => ({
      openBucket: setBucketId,
      openTransaction: setTxnId,
      openAdd: (id) => {
        setBucketId(null)
        setAdding({ bucketId: id })
      },
      toast: setToast,
    }),
    [],
  )

  return (
    <SheetsContext.Provider value={sheets}>
      <main className="app">
        {route === '/' && <Home />}
        {route === '/timeline' && <Timeline onOpenBucket={setBucketId} />}
        {route === '/insights' && <Insights />}
        {route === '/inbox' && <Inbox />}
        {route === '/plan' && <Plan />}
        {route === '/plan/allocate' && <Allocate onDone={setToast} />}
        {route === '/settings' && <Settings onSimulate={() => setSimulating(true)} onToast={setToast} />}
        {route === '/accounts' && <Accounts />}
        {route === '/activity' && <Activity />}
      </main>

      {!isAllocating && (
        <>
          <button className="fab" aria-label="Add transaction" onClick={() => setAdding({ bucketId: null })}>
            <PlusIcon />
          </button>
          <nav className="tabbar" aria-label="Main">
            {TABS.map((tab) => {
              const active = activeTab === tab.route
              return (
                <button
                  key={tab.route}
                  className={`tabbar__item ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(tab.route)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tab.route === '/inbox' && inboxCount > 0 && <span className="tabbar__badge">{inboxCount}</span>}
                </button>
              )
            })}
          </nav>
        </>
      )}

      {bucketId && <BucketSheet key={bucketId} bucketId={bucketId} onClose={() => setBucketId(null)} />}
      {txnId && <TransactionSheet key={txnId} txnId={txnId} onClose={() => setTxnId(null)} />}
      {adding && <AddTransactionSheet key={adding.bucketId ?? 'new'} open initialBucketId={adding.bucketId} onClose={() => setAdding(null)} />}
      <SimulateSmsSheet open={simulating} onClose={() => setSimulating(false)} onResult={setToast} />
      <Toast message={toast} onDone={clearToast} />
    </SheetsContext.Provider>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
