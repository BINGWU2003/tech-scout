import { describe, expect, it } from 'vitest'
import { countryName, eventLabels, nodeLabels, statusLabels } from './labels'

describe('v2 研究文案', () => {
  it('使用自动主体解析状态且不再暴露人工核验动作', () => {
    expect(nodeLabels).toMatchObject({
      assignee: '聚合权利人',
      entity: '解析主体',
      analyze: '分析企业技术相关性',
    })
    expect(Object.keys(statusLabels)).toEqual(
      expect.arrayContaining([
        'awaiting_plan',
        'awaiting_companies',
        'completed',
      ])
    )
    expect(eventLabels.start_companies).toBe('开始企业发现')
  })

  it('显示已知国家名称', () => {
    expect(countryName('CN')).toBe('中国')
    expect(countryName(null)).toBe('未提供')
  })
})
