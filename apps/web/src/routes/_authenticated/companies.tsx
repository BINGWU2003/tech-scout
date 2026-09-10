import { createFileRoute } from '@tanstack/react-router'
import { librarySearchSchema } from '@/features/library/library-navigation'
import { LibraryPage } from '@/features/library/library-page'

export const Route = createFileRoute('/_authenticated/companies')({
  validateSearch: librarySearchSchema,
  component: function LibraryRoute() {
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <LibraryPage
        kind='companies'
        search={search}
        onSearchChange={(next, replace) =>
          void navigate({ search: next, replace })
        }
      />
    )
  },
})
