import { createFileRoute } from '@tanstack/react-router'
import { CatalogDomainCompaniesPage } from '@/features/catalog/pages/catalog-domain-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/domains/$domainId/companies'
)({
  component: CatalogDomainCompaniesPage,
})
