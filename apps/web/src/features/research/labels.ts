export const statusLabels: Record<string, string> = {
  queued: '等待执行',
  running: '研究中',
  awaiting_plan: '待确认计划',
  awaiting_companies: '待开始企业发现',
  completed: '已完成',
  empty: '无匹配结果',
  failed: '执行失败',
  recoverable: '可恢复',
  cancelled: '已取消',
}
export const nodeLabels: Record<string, string> = {
  context: '确定研究范围',
  planner: '生成计划',
  search_planner: '生成检索条件',
  plan_gate: '确认计划',
  snapshot: '采集专利',
  patent: '筛选专利',
  assignee: '聚合权利人',
  company_gate: '确认企业发现',
  company_snapshot: '查询企业信息',
  company: '整理企业候选',
  entity: '解析主体',
  analyze: '分析企业技术相关性',
  finish: '保存结果',
}

const countryLabels: Record<string, string> = {
  CN: '中国',
  US: '美国',
}

export function countryName(country: string | null) {
  return country ? (countryLabels[country] ?? country) : '未提供'
}

export const eventLabels: Record<string, string> = {
  acquisition_progress: '采集进度已更新',
  started: '开始执行',
  node_started: '步骤开始',
  node_completed: '状态已保存',
  model_reserved: '预留调用预算',
  model_usage: '记录模型用量',
  awaiting_plan: '等待计划确认',
  execution_stopped: '执行已停止',
  confirm_plan: '计划已确认',
  start_companies: '开始企业发现',
  awaiting_companies: '专利采集完成，等待开始企业发现',
  planner_progress: '技术方向生成进度',
  search_progress: '检索记录',
  completed: '研究完成',
  empty: '无匹配结果',
  failed: '执行失败',
  recoverable: '等待恢复',
  retry: '收到手动重试',
  pause: '收到暂停请求',
  cancel: '收到取消请求',
  cancelled: '研究已取消',
}
