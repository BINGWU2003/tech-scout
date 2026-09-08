import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { LibraryPage } from '@/features/library/library-page'
export const Route = createFileRoute('/_authenticated/patents')({
  validateSearch: z.object({ id: z.string().optional() }),
  component: function LibraryRoute() {
    const { id } = Route.useSearch()
    return <LibraryPage kind='patents' selectedId={id} />
  },
})
