import { createFileRoute } from '@tanstack/react-router'
import { ResearchList } from '@/features/research/research-list'
export const Route = createFileRoute('/_authenticated/research/')({
  component: ResearchList,
})
