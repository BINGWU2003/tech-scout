import { createFileRoute } from '@tanstack/react-router'
import { catalogCompanyListQuerySchema } from '@tech-scout/contracts'
import { createCatalogSearchValidator } from '@/features/catalog/hooks/use-catalog-query-state'
import { CatalogCompaniesPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute('/_authenticated/catalog/companies/')({
  validateSearch: createCatalogSearchValidator(catalogCompanyListQuerySchema),
  component: CatalogCompaniesPage,
})
