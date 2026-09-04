import { createFileRoute } from '@tanstack/react-router'
import { CatalogCandidatePage } from '@/features/catalog/pages/catalog-evidence-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/candidates/$candidateId'
)({
  component: CatalogCandidatePage,
})
