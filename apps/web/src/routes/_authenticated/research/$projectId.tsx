import { createFileRoute, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
export const Route = createFileRoute('/_authenticated/research/$projectId')({
  validateSearch: z.object({ runId: z.uuid().optional().catch(undefined) }),
  component: Outlet,
})
