import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { ApiClientError } from '@/lib/api-client-error'
import { authApi } from '@/lib/auth-api'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const auth = useAuthStore.getState().auth
    if (auth.user) return
    try {
      auth.setSession(await authApi.me())
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        throw redirect({
          to: '/sign-in',
          search: { redirect: location.href },
        })
      }
      throw error
    }
  },
  component: AuthenticatedLayout,
})
