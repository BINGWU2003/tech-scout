import { createFileRoute } from '@tanstack/react-router'
import { catalogPageQuerySchema } from '@tech-scout/contracts'
import { createCatalogSearchValidator } from '@/features/catalog/hooks/use-catalog-query-state'
import { CatalogCandidatePage } from '@/features/catalog/pages/catalog-evidence-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/candidates/$candidateId'
)({
  validateSearch: createCatalogSearchValidator(catalogPageQuerySchema),
  component: CatalogCandidatePage,
})
