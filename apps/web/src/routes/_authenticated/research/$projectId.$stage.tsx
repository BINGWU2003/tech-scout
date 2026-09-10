import { createFileRoute, redirect } from '@tanstack/react-router'
import { ResearchDetail } from '@/features/research/research-detail'
import {
  researchStages,
  type ResearchStage,
} from '@/features/research/research-stage'
export const Route = createFileRoute(
  '/_authenticated/research/$projectId/$stage'
)({
  beforeLoad: ({ params, search }) => {
    if (!Object.prototype.hasOwnProperty.call(researchStages, params.stage))
      throw redirect({
        to: '/research/$projectId',
        params: { projectId: params.projectId },
        search,
      })
  },
  component: function StagePage() {
    const { projectId, stage } = Route.useParams()
    const { runId } = Route.useSearch()
    return (
      <ResearchDetail
        projectId={projectId}
        runId={runId}
        stage={stage as ResearchStage}
      />
    )
  },
})
