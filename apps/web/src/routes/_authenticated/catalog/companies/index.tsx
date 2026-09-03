import { createFileRoute } from '@tanstack/react-router'
import { catalogCompanyListQuerySchema } from '@tech-scout/contracts'
import { CatalogCompaniesPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute('/_authenticated/catalog/companies/')({
  validateSearch: catalogCompanyListQuerySchema,
  component: CatalogCompaniesPage,
})
