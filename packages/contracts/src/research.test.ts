import { describe, expect, it } from 'vitest'
import { researchCandidateViewSchema } from './research-view.js'
import {
  researchActionSchema,
  researchCreateSchema,
  researchPlanSchema,
} from './research.js'

describe('阶段 2 输入契约', () => {
  it('空白问题、反向年份以及越权 actor 字段不可接受', () => {
    expect(
      researchCreateSchema.safeParse({
        requestKey: '423c8a2b-afc5-40e7-9da4-4135c272fc48',
        question: '   ',
      }).success
    ).toBe(false)
    expect(
      researchPlanSchema.safeParse({
        directions: [{ domain_id: 'd', name: '方向', explanation: '依据' }],
        from_year: 2025,
        to_year: 2024,
      }).success
    ).toBe(false)
    expect(
      researchActionSchema.safeParse({
        action_id: '423c8a2b-afc5-40e7-9da4-4135c272fc48',
        kind: 'cancel',
        actor_id: 'caller-cannot-select-actor',
      }).success
    ).toBe(false)
  })
  it('确认计划必须提供计划，其他动作不能夹带计划或身份决定', () => {
    const action_id = '423c8a2b-afc5-40e7-9da4-4135c272fc48'
    expect(
      researchActionSchema.safeParse({ action_id, kind: 'confirm_plan' })
        .success
    ).toBe(false)
    expect(
      researchActionSchema.safeParse({
        action_id,
        kind: 'retry',
        decisions: [{ candidate_id: 'c', action: 'skip' }],
      }).success
    ).toBe(false)
    expect(
      researchActionSchema.parse({
        action_id,
        kind: 'resolve_entities',
        decisions: [{ candidate_id: 'c', action: 'skip' }],
      }).decisions[0].evidence_ids
    ).toEqual([])
  })
})

describe('待核对主体输出契约', () => {
  it('区分建议国家、确认国家和未知国家', () => {
    const candidate = researchCandidateViewSchema.parse({
      id: 'candidate-1',
      name: '示例科技有限公司',
      country: 'CN',
      countryStatus: 'suggested',
      countrySource: 'tianyancha',
      status: 'unverified',
      needsReview: true,
      terminalExclusion: false,
      decision: null,
      patentCount: 6,
    })

    expect(candidate).toMatchObject({
      country: 'CN',
      countryStatus: 'suggested',
      countrySource: 'tianyancha',
    })
  })
})
