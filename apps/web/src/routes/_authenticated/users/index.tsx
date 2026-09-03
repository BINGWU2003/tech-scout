import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'
import { Users } from '@/features/users'
import { useAuthStore } from '@/stores/auth-store'

const usersSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(20),
  status: z.enum(['active', 'disabled']).optional().catch(undefined),
  role: z.enum(['user', 'admin']).optional().catch(undefined),
  search: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/users/')({
  validateSearch: usersSearchSchema,
  beforeLoad: () => {
    if (useAuthStore.getState().auth.user?.role !== 'admin') {
      throw redirect({ to: '/403' })
    }
  },
  component: Users,
})
