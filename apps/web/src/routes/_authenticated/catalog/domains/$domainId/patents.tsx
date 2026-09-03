import { createFileRoute } from '@tanstack/react-router'
import { catalogPatentListQuerySchema } from '@tech-scout/contracts'
import { CatalogDomainPatentsPage } from '@/features/catalog/pages/catalog-domain-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/domains/$domainId/patents'
)({
  validateSearch: catalogPatentListQuerySchema,
  component: CatalogDomainPatentsPage,
})
