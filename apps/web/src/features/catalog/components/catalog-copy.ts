const catalogDomainNames: Record<string, string> = {
  ai_chips_edge_inference: 'AI 芯片与边缘推理',
  industrial_vision_quality_inspection: '工业视觉与 AI 质量检测',
}

const aliasTypes: Record<string, string> = {
  legal_name: '法定名称',
  official_legal_name: '官方法定名称',
  other_name: '其他名称',
  patent_assignee: '专利受让人名称',
  registered_name: '登记名称',
  transliterated_other_name: '转写名称',
}

const candidateDecisions: Record<string, string> = {
  accepted: '已确认公司主体',
  insufficient_evidence: '证据不足',
  non_company: '非公司主体',
  rejected: '已排除当前匹配建议',
  verified_unmatched: '已核实，暂未匹配',
}

const matchMethods: Record<string, string> = {
  evidence_rule: '证据规则匹配',
  exact_alias: '别名精确匹配',
  fuzzy_name: '名称模糊匹配',
  gleif_exact_multiple: '多个 GLEIF 精确候选',
  gleif_exact_name_country: 'GLEIF 名称与国家/地区精确匹配',
  gleif_fuzzy_name_country: 'GLEIF 名称与国家/地区模糊匹配',
  human_selected: '审核选定',
  manual: '人工审核',
  missing_country: '缺少国家/地区',
  name_similarity: '名称相似度匹配',
  no_candidate: '未找到候选公司',
  sec_exact_name: 'SEC 名称精确匹配',
  unique_legal_name: '唯一法定名称匹配',
}

const organizationTypes: Record<string, string> = {
  company: '公司',
  government: '政府机构',
  individual: '个人',
  other_non_company: '其他非公司主体',
  research_institute: '研究机构',
  university: '高校',
  unknown: '待确认',
}

const partyRoles: Record<string, string> = {
  assignee: '受让人',
}

const patentTypes: Record<string, string> = {
  design: '外观设计专利',
  plant: '植物专利',
  reissue: '再颁专利',
  utility: '实用专利',
}

const reviewMethods: Record<string, string> = {
  evidence_rule: '证据规则核验',
  legacy_review: '历史审核记录',
  manual: '人工审核',
  official_sources_exhausted: '已完成官方来源核查',
  official_sources_insufficient: '官方来源证据不足',
  strong_official_evidence: '官方证据交叉验证',
  strong_official_identifier: '官方稳定标识核验',
  user_confirmed_legacy: '历史审核记录',
}

const sourceTypes: Record<string, string> = {
  official_bulk_data: '官方批量数据',
  official_company_site: '公司官网',
  official_record: '官方记录',
  official_registry: '官方注册机构',
  regulatory_filing: '监管申报文件',
}

function translatedValue(value: string, translations: Record<string, string>) {
  return translations[value] ?? value
}

export function formatAliasType(value: string) {
  return translatedValue(value, aliasTypes)
}

export function formatAuditStatus(value: null | string) {
  if (!value) return '未提供'
  if (value === 'ACTIVE') return '有效（ACTIVE）'
  if (value === 'INACTIVE') return '无效（INACTIVE）'
  return value
}

export function formatCandidateDecision(value: string) {
  return translatedValue(value, candidateDecisions)
}

export function formatCatalogDomainName(domainId: string, name: string) {
  const localizedName = getCatalogDomainLocalizedName(domainId)
  return localizedName ? `${localizedName}（${name}）` : name
}

export function getCatalogDomainLocalizedName(domainId: string) {
  return catalogDomainNames[domainId]
}

export function formatMatchMethod(value: string) {
  return translatedValue(value, matchMethods)
}

export function formatOrganizationType(value: string) {
  return translatedValue(value, organizationTypes)
}

export function formatPartyRole(value: string) {
  return translatedValue(value, partyRoles)
}

export function formatPatentType(value: string) {
  return translatedValue(value, patentTypes)
}

export function formatReviewMethod(value: string) {
  return translatedValue(value, reviewMethods)
}

export function formatSourceType(value: string) {
  return translatedValue(value, sourceTypes)
}
