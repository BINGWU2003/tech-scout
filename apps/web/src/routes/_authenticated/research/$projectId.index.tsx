import { createFileRoute } from '@tanstack/react-router'
import { ResearchEntry } from '@/features/research/research-detail'
export const Route = createFileRoute('/_authenticated/research/$projectId/')({
  component: function ProjectEntry() {
    const { projectId } = Route.useParams()
    const { runId } = Route.useSearch()
    return <ResearchEntry projectId={projectId} runId={runId} />
  },
})
