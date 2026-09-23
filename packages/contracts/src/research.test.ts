import { describe, expect, it } from 'vitest'
import { researchCompanyDetailViewSchema } from './research-view.js'
import {
  researchActionSchema,
  researchCreateSchema,
  researchPlanSchema,
  researchConversationMessageSchema,
} from './research.js'

describe('阶段 2 输入契约', () => {
  it('要求显式的思考选项和消息状态，不接受缺少新字段的旧记录', () => {
    const input = { requestKey: crypto.randomUUID(), question: '视觉研究' }
    expect(researchCreateSchema.safeParse(input).success).toBe(false)
    expect(
      researchCreateSchema.safeParse({ ...input, thinking: false }).success
    ).toBe(true)
    const message = {
      id: 'message',
      runId: null,
      role: 'user',
      text: '视觉研究',
      createdAt: '2026-09-12T00:00:00Z',
      plan: null,
    }
    expect(researchConversationMessageSchema.safeParse(message).success).toBe(
      false
    )
    expect(
      researchConversationMessageSchema.safeParse({
        ...message,
        reasoning: null,
        answer: null,
        pending: false,
      }).success
    ).toBe(true)
  })
  it('空白问题、反向年份以及越权 actor 字段不可接受', () => {
    expect(
      researchCreateSchema.safeParse({
        requestKey: '423c8a2b-afc5-40e7-9da4-4135c272fc48',
        question: '   ',
        thinking: true,
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
  it('确认计划必须提供计划，且旧人工决定动作不可接受', () => {
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
      researchActionSchema.safeParse({
        action_id,
        kind: 'legacy_action',
        obsoletePayload: [{ id: 'c' }],
      }).success
    ).toBe(false)
  })
})

describe('企业查询线索契约', () => {
  it('保留权利人和匹配依据，不宣称专利权属', () => {
    const detail = researchCompanyDetailViewSchema.parse({
      id: 'company-1',
      name: '示例科技有限公司',
      legalName: '示例科技有限公司',
      country: 'CN',
      businessInfo: {},
      aliases: [],
      identifiers: [],
      source: { url: null, sha256: null },
      relations: [
        { patentId: 'p1', assigneeName: '示例科技', basis: 'search_hit' },
      ],
    })
    expect(detail.relations[0]).toEqual({
      patentId: 'p1',
      assigneeName: '示例科技',
      basis: 'search_hit',
    })
  })
})
