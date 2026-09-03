import { createFileRoute } from '@tanstack/react-router'
import { CatalogCompanyPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/companies/$companyId/'
)({
  component: CatalogCompanyPage,
})
