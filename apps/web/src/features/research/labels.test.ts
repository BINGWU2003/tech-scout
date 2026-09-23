import { describe, expect, it } from 'vitest'
import { countryName, eventLabels, nodeLabels, statusLabels } from './labels'

describe('v3 研究文案', () => {
  it('将专利和企业评估归入报告阶段', () => {
    expect(nodeLabels).toMatchObject({
      assignee: '聚合权利人',
      assess_patents: '评估专利优先级',
      analyze: '分析企业调研优先级',
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
