export const statusLabels: Record<string, string> = {
  queued: '等待执行',
  running: '研究中',
  awaiting_plan: '待确认计划',
  awaiting_entities: '待确认主体',
  completed: '已完成',
  empty: '无匹配结果',
  failed: '执行失败',
  recoverable: '可恢复',
  cancelled: '已取消',
}
export const nodeLabels: Record<string, string> = {
  context: '确定研究范围',
  planner: '生成计划',
  plan_gate: '确认计划',
  snapshot: '采集专利与企业',
  patent: '筛选专利',
  company: '关联企业',
  entity: '核验主体',
  evidence: '分析证据',
  finish: '保存结果',
}
export const decisionLabels: Record<string, string> = {
  not_found: '天眼查未找到',
  unverified: '待核对',
  accepted: '已接受',
  auto_accepted: '自动匹配',
  insufficient_evidence: '证据不足',
  non_company: '非公司主体',
  rejected: '已拒绝',
  reject: '本次拒绝',
  skip: '本次跳过',
  confirm: '本次确认',
  unresolved: '待处理',
}

type CandidateCountry = {
  country: string | null
  countryStatus: 'verified' | 'suggested' | 'unknown'
  countrySource: string | null
}

const countryLabels: Record<string, string> = {
  CN: '中国',
  US: '美国',
}

const countrySourceLabels: Record<string, string> = {
  patent: '专利来源',
  tianyancha: '天眼查',
}

export function countryName(country: string | null) {
  return country ? (countryLabels[country] ?? country) : '未提供'
}

export function candidateCountryLabel(candidate: CandidateCountry) {
  if (!candidate.country || candidate.countryStatus === 'unknown')
    return '申请人注册地尚未核验'
  const country = countryName(candidate.country)
  if (candidate.countryStatus === 'suggested') {
    const source = candidate.countrySource
      ? (countrySourceLabels[candidate.countrySource] ??
        candidate.countrySource)
      : '企业登记证据'
    return `候选企业注册地：${country}（${source}，待确认）`
  }
  return `企业注册地：${country}（已确认）`
}

export const eventLabels: Record<string, string> = {
  acquisition_progress: '采集进度已更新',
  started: '开始执行',
  node_started: '步骤开始',
  node_completed: '状态已保存',
  model_reserved: '预留调用预算',
  model_usage: '记录模型用量',
  awaiting_plan: '等待计划确认',
  awaiting_entities: '等待主体确认',
  execution_stopped: '执行已停止',
  confirm_plan: '计划已确认',
  resolve_entities: '主体决定已提交',
  completed: '研究完成',
  empty: '无匹配结果',
  failed: '执行失败',
  recoverable: '等待恢复',
  retry: '收到手动重试',
  pause: '收到暂停请求',
  cancel: '收到取消请求',
  cancelled: '研究已取消',
}
