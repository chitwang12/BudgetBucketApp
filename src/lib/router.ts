import { useEffect, useState } from 'react'

export type Route =
  | '/'
  | '/timeline'
  | '/insights'
  | '/inbox'
  | '/plan'
  | '/plan/allocate'
  | '/settings'
  | '/accounts'
  | '/activity'

const ROUTES: Route[] = ['/', '/timeline', '/insights', '/inbox', '/plan', '/plan/allocate', '/settings', '/accounts', '/activity']

function readRoute(): Route {
  const path = window.location.hash.replace(/^#/, '') || '/'
  return (ROUTES as string[]).includes(path) ? (path as Route) : '/'
}

export function navigate(route: Route): void {
  window.location.hash = route
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
