import type {
  ResearchProgressView,
  ResearchSummaryView,
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
    title: '企业发现与核验',
    description: '查询相关企业，核对主体身份和登记依据。',
  },
  report: { title: '研究报告', description: '查看分析结论与引用证据。' },
} as const
export type ResearchStage = keyof typeof researchStages

export function stageForNode(node: string | null): ResearchStage {
  if (
    ['search_planner', 'snapshot', 'patent', 'company_gate'].includes(
      node ?? ''
    )
  )
    return 'patents'
  if (['company_snapshot', 'company', 'entity'].includes(node ?? ''))
    return 'companies'
  if (['evidence', 'finish'].includes(node ?? '')) return 'report'
  return 'plan'
}
export function stageForRun(run: ResearchSummaryView): ResearchStage {
  if (run.hasResult) return 'report'
  if (run.status === 'queued') {
    if (run.node === 'plan_gate') return 'patents'
    if (run.node === 'company_gate') return 'companies'
    if (run.node === 'entity') return 'report'
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
