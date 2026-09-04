import { createFileRoute } from '@tanstack/react-router'
import { CatalogCompanyPatentsPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/companies/$companyId/patents'
)({
  component: CatalogCompanyPatentsPage,
})
