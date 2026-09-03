import { createFileRoute } from '@tanstack/react-router'
import { catalogPageQuerySchema } from '@tech-scout/contracts'
import { CatalogCandidatePage } from '@/features/catalog/pages/catalog-evidence-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/candidates/$candidateId'
)({
  validateSearch: catalogPageQuerySchema,
  component: CatalogCandidatePage,
})
