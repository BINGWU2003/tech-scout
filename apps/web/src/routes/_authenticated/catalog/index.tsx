import { createFileRoute } from '@tanstack/react-router'
import { CatalogOverview } from '@/features/catalog/components/catalog-overview'

export const Route = createFileRoute('/_authenticated/catalog/')({
  component: CatalogOverview,
})
