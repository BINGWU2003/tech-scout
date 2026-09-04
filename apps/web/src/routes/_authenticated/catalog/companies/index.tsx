import { createFileRoute } from '@tanstack/react-router'
import { CatalogCompaniesPage } from '@/features/catalog/pages/catalog-company-pages'

export const Route = createFileRoute('/_authenticated/catalog/companies/')({
  component: CatalogCompaniesPage,
})
