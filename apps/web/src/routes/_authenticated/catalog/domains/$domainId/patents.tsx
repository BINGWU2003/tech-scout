import { createFileRoute } from '@tanstack/react-router'
import { CatalogDomainPatentsPage } from '@/features/catalog/pages/catalog-domain-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/domains/$domainId/patents'
)({
  component: CatalogDomainPatentsPage,
})
