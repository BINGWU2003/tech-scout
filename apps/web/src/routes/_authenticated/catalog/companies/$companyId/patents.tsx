import { createFileRoute } from '@tanstack/react-router'
import { catalogCompanyPatentListQuerySchema } from '@tech-scout/contracts'
import { CatalogCompanyPatentsPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/companies/$companyId/patents'
)({
  validateSearch: catalogCompanyPatentListQuerySchema,
  component: CatalogCompanyPatentsPage,
})
