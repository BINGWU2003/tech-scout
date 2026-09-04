import { createFileRoute } from '@tanstack/react-router'
import { catalogPatentListQuerySchema } from '@tech-scout/contracts'
import { createCatalogSearchValidator } from '@/features/catalog/hooks/use-catalog-query-state'
import { CatalogDomainPatentsPage } from '@/features/catalog/pages/catalog-domain-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/domains/$domainId/patents'
)({
  validateSearch: createCatalogSearchValidator(catalogPatentListQuerySchema),
  component: CatalogDomainPatentsPage,
})
