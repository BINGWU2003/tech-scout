import { createFileRoute } from '@tanstack/react-router'
import { CatalogPatentPage } from '@/features/catalog/pages/catalog-evidence-pages'

export const Route = createFileRoute(
  '/_authenticated/catalog/patents/$patentId'
)({
  component: CatalogPatentPage,
})
