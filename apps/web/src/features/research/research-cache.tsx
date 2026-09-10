import { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'

const ResearchCacheContext = createContext<QueryClient | null>(null)
function AccountCache({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 10000 },
          mutations: { retry: false },
        },
      })
  )
  return (
    <ResearchCacheContext.Provider value={client}>
      {children}
    </ResearchCacheContext.Provider>
  )
}
export function ResearchCache({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  return <AccountCache key={userId ?? 'signed-out'}>{children}</AccountCache>
}
// eslint-disable-next-line react-refresh/only-export-components
export function useResearchClient() {
  const client = useContext(ResearchCacheContext)
  if (!client) throw new Error('ResearchCache is required')
  return client
}
