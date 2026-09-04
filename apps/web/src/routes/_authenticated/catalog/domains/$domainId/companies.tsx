import { createFileRoute } from '@tanstack/react-router'
import { catalogCompanyListQuerySchema } from '@tech-scout/contracts'
import { createCatalogSearchValidator } from '@/features/catalog/hooks/use-catalog-query-state'
import { CatalogDomainCompaniesPage } from '@/features/catalog/pages/catalog-domain-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/domains/$domainId/companies'
)({
  validateSearch: createCatalogSearchValidator(catalogCompanyListQuerySchema),
  component: CatalogDomainCompaniesPage,
})
