import { createFileRoute } from '@tanstack/react-router'
import { catalogCompanyListQuerySchema } from '@tech-scout/contracts'
import { CatalogDomainCompaniesPage } from '@/features/catalog/pages/catalog-domain-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/domains/$domainId/companies'
)({
  validateSearch: catalogCompanyListQuerySchema,
  component: CatalogDomainCompaniesPage,
})
