import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ResearchDetail } from '@/features/research/research-detail'
export const Route = createFileRoute('/_authenticated/research/$projectId')({
  validateSearch: z.object({ runId: z.uuid().optional().catch(undefined) }),
  component: function ProjectPage() {
    const { projectId } = Route.useParams()
    const { runId } = Route.useSearch()
    return (
      <ResearchDetail key={projectId} projectId={projectId} runId={runId} />
    )
  },
})
