import { createFileRoute } from '@tanstack/react-router'
import { ResearchLayout } from '@/features/research/research-layout'
export const Route = createFileRoute('/_authenticated/research')({
  component: ResearchLayout,
})
