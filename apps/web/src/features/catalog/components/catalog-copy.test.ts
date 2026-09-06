import { describe, expect, it } from 'vitest'
import {
  formatAliasType,
  formatAuditStatus,
  formatCatalogDomainName,
  formatMatchMethod,
  formatPatentType,
} from './catalog-copy'

describe('Catalog 界面术语', () => {
  it('将已知枚举转换为面向业务用户的中文', () => {
    expect(formatAliasType('legal_name')).toBe('法定名称')
    expect(formatMatchMethod('exact_alias')).toBe('别名精确匹配')
    expect(formatPatentType('utility')).toBe('实用专利')
  })

  it('为未知开放枚举保留原始值', () => {
    expect(formatAliasType('future_alias_type')).toBe('future_alias_type')
    expect(formatMatchMethod('future_match_method')).toBe('future_match_method')
  })

  it('以中文名称和英文原名显示已知技术领域', () => {
    expect(
      formatCatalogDomainName(
        'ai_chips_edge_inference',
        'AI chips and edge inference'
      )
    ).toBe('AI 芯片与边缘推理（AI chips and edge inference）')
    expect(formatCatalogDomainName('future_domain', 'Future domain')).toBe(
      'Future domain'
    )
  })

  it('审计状态同时显示中文含义和原始值', () => {
    expect(formatAuditStatus('ACTIVE')).toBe('有效（ACTIVE）')
  })
})
