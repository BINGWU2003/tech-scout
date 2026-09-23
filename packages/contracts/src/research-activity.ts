/** Shared by the project list and live run updates. Terminal states take precedence. */
export function researchActivityLabel(
  run: {
    status: string | null
    node?: string | null
    error?: unknown
    ready?: boolean
    acquisition?: {
      stage?: string | null
      status?: string | null
      completed?: number | null
      total?: number | null
    } | null
  },
  reasoning?: string | null
): string {
  const labels: Record<string, string> = {
    awaiting_plan: '待确认计划',
    awaiting_companies: '专利已就绪 · 待查询企业',
    completed: '研究已完成',
    empty: '研究已结束 · 无匹配结果',
    cancelled: '研究已取消',
    failed: '执行失败',
  }
  if (run.status === 'recoverable')
    return run.error ? '执行失败 · 可重试' : '已暂停'
  if (run.status && labels[run.status]) return labels[run.status]
  if (run.status === 'queued' || run.ready === false) {
    if (run.node === 'plan_gate') return '正在准备检索专利'
    if (run.node === 'company_gate') return '正在准备查询企业'
    if (run.node === 'assess_patents') return '正在准备评估专利'
    return '等待开始'
  }
  const acquisition = run.acquisition
  // Acquisition remains in the snapshot after later nodes start.
  if (
    ['snapshot', 'company_snapshot'].includes(run.node ?? '') &&
    acquisition?.status === 'running'
  ) {
    const stages: Record<string, string> = {
      search: '正在检索专利',
      patents: '正在获取专利详情',
      companies: '正在查询企业信息',
      snapshot: '正在保存采集结果',
    }
    const label = stages[acquisition.stage ?? '']
    if (label)
      return acquisition.total != null
        ? `${label} · ${acquisition.completed ?? 0}/${acquisition.total}`
        : label
  }
  const nodes: Record<string, string> = {
    search_planner: '正在生成检索条件',
    snapshot: '正在检索专利',
    patent: '正在筛选专利',
    assignee: '正在聚合权利人',
    company_gate: '正在准备查询企业',
    company_snapshot: '正在查询企业信息',
    company: '正在整理企业查询结果',
    assess_patents: '正在评估专利优先级',
    analyze: '正在分析企业调研优先级',
    finish: '正在生成研究报告',
  }
  return (
    nodes[run.node ?? ''] ??
    (['answering', 'completed'].includes(reasoning ?? '')
      ? '正在生成回答…'
      : '正在思考…')
  )
}
