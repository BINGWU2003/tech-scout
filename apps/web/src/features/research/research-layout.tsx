import { QueryClientProvider } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { useResearchClient } from './research-cache'

export function ResearchLayout() {
  return (
    <QueryClientProvider client={useResearchClient()}>
      <Outlet />
    </QueryClientProvider>
  )
}
