import type {
  ResearchProgressView,
  ResearchSummaryView,
  ResearchWorkspace,
} from '@tech-scout/contracts'

export const researchStages = {
  plan: {
    title: '技术方向与计划',
    description: '拆解研究需求，调整并确认检索计划。',
  },
  patents: {
    title: '专利检索',
    description: '查看检索过程与专利，准备好后再开始企业发现。',
  },
  companies: {
    title: '企业发现',
    description: '查看天眼查企业查询结果与权利人线索。',
  },
  report: { title: '研究报告', description: '查看分析结论与引用证据。' },
} as const
export type ResearchStage = keyof typeof researchStages

export function researchStageLabel(
  stage: ResearchStage,
  workspace: ResearchWorkspace
) {
  const stages = Object.keys(researchStages) as ResearchStage[]
  const index = stages.indexOf(stage)
  const reached = stages.indexOf(workspace.reachedStage)
  if (index > reached) return '未开始'
  if (index < reached) return '已完成'
  const labels = {
    draft: '待完善',
    awaiting_confirmation: '待确认',
    queued: '排队中',
    running: '处理中',
    completed: '已完成',
    paused: '已暂停',
    failed: '失败',
    cancelled: '已取消',
  }
  if (workspace.currentStageStatus) return labels[workspace.currentStageStatus]
  if (workspace.researchCompleted) return '已完成'
  if (stage === 'plan')
    return workspace.selectedPlan.directions.length ? '待确认' : '待完善'
  return '状态更新中'
}

export function stageForNode(node: string | null): ResearchStage {
  if (
    [
      'search_planner',
      'snapshot',
      'patent',
      'assignee',
      'company_gate',
    ].includes(node ?? '')
  )
    return 'patents'
  if (['company_snapshot', 'company'].includes(node ?? '')) return 'companies'
  if (['assess_patents', 'analyze', 'finish'].includes(node ?? ''))
    return 'report'
  return 'plan'
}
export function stageForRun(run: ResearchSummaryView): ResearchStage {
  if (run.hasResult) return 'report'
  if (run.status === 'queued') {
    if (run.node === 'plan_gate') return 'patents'
    if (run.node === 'company_gate') return 'companies'
    if (run.node === 'assess_patents') return 'report'
  }
  return stageForNode(run.error?.node ?? run.node)
}
export function stageForEvent(event: ResearchProgressView): ResearchStage {
  const stage = event.process?.stage ?? event.acquisition?.stage
  if (stage === 'planner') return 'plan'
  if (stage === 'search' || stage === 'patents') return 'patents'
  if (stage === 'companies') return 'companies'
  return stageForNode(event.node)
}
