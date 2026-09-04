import { createFileRoute } from '@tanstack/react-router'
import { catalogCompanyPatentListQuerySchema } from '@tech-scout/contracts'
import { createCatalogSearchValidator } from '@/features/catalog/hooks/use-catalog-query-state'
import { CatalogCompanyPatentsPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/companies/$companyId/patents'
)({
  validateSearch: createCatalogSearchValidator(
    catalogCompanyPatentListQuerySchema
  ),
  component: CatalogCompanyPatentsPage,
})
