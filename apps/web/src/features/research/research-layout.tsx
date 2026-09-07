import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'

function AccountResearchCache() {
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
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  )
}

export function ResearchLayout() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  // A fresh cache on account change prevents another account seeing stale projects.
  return <AccountResearchCache key={userId ?? 'signed-out'} />
}
