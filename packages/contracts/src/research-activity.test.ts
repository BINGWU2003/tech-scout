import { expect, it } from 'vitest'
import { researchActivityLabel } from './research-activity.js'

const acquisition = {
  stage: 'patents',
  status: 'running',
  completed: 18,
  total: 50,
}

it('keeps stage completion distinct from whole-research completion', () => {
  expect(
    researchActivityLabel({
      status: 'awaiting_companies',
      node: 'company_gate',
      acquisition,
    })
  ).toBe('专利已就绪 · 待查询企业')
  expect(
    researchActivityLabel({ status: 'completed', node: 'finish', acquisition })
  ).toBe('研究已完成')
  expect(researchActivityLabel({ status: 'awaiting_entities' })).toBe(
    '待核验主体'
  )
})

it('distinguishes pause from recoverable failure even with stale progress', () => {
  expect(researchActivityLabel({ status: 'recoverable', acquisition })).toBe(
    '已暂停'
  )
  expect(
    researchActivityLabel({
      status: 'recoverable',
      acquisition,
      error: { message: 'timeout' },
    })
  ).toBe('执行失败 · 可重试')
})

it('shows detailed progress only in the corresponding acquisition node', () => {
  expect(
    researchActivityLabel({ status: 'running', node: 'snapshot', acquisition })
  ).toBe('正在获取专利详情 · 18/50')
  expect(
    researchActivityLabel({ status: 'running', node: 'evidence', acquisition })
  ).toBe('正在分析证据')
  expect(
    researchActivityLabel({
      status: 'queued',
      node: 'company_gate',
      acquisition,
    })
  ).toBe('正在准备查询企业')
})
