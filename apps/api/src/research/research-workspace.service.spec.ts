import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../database/prisma.service.js'
import { ResearchWorkspaceService } from './research-workspace.service.js'
import type { ResearchService } from './research.service.js'

const plan = {
  from_year: 2020,
  to_year: 2026,
  risks: [],
  directions: [
    {
      domain_id: 'edge-inference',
      name: '边缘推理',
      explanation: '关注轻量化算法。',
      keywords: [],
      excluded_keywords: [],
      cpc_prefixes: [],
    },
  ],
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    question: '推荐技术方向',
    status: 'awaiting_plan',
    createdAt: new Date('2026-09-12T00:00:00Z'),
    context: {},
    plan,
    candidates: null,
    confirmed: null,
    reply: '结合需求，建议从以下方向展开研究。',
    reasoning: null,
    answer: null,
    intent: 'refresh_candidates',
    proposal: null,
    hasResult: false,
    ...overrides,
  }
}

async function workspace(runs: ReturnType<typeof run>[]) {
  const prisma = {
    researchProject: {
      findFirst: vi.fn().mockResolvedValue({ workspace: {} }),
    },
    $queryRaw: vi.fn().mockResolvedValue(runs),
    researchCommand: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  }
  return new ResearchWorkspaceService(
    prisma as unknown as PrismaService,
    {} as ResearchService
  ).get(randomUUID(), randomUUID())
}

describe('多轮推荐卡片', () => {
  it('明确推荐意图的后续规划成为最新推荐，旧推荐失效', async () => {
    const first = run()
    const next = run({
      question: '算法相关',
      context: { workspace: true, startSearch: false },
      createdAt: new Date('2026-09-12T00:00:01Z'),
    })
    const result = await workspace([first, next])
    const replies = result.messages.filter((m) => m.role === 'assistant')
    expect(replies).toMatchObject([
      { runId: first.id, recommendation: true, outdated: true },
      { runId: next.id, recommendation: true, outdated: false, plan },
    ])
    expect(result.selectedPlan.directions).toEqual([])
  })

  it.each(['discuss', 'propose_selected'])(
    '明确的 %s 不抢占最新推荐',
    async (intent) => {
      const first = run()
      const next = run({
        context: { workspace: true },
        intent,
        reply: '这是讨论或修改建议。',
        candidates: plan,
        proposal: intent === 'propose_selected' ? plan : null,
        createdAt: new Date('2026-09-12T00:00:01Z'),
      })
      const result = await workspace([first, next])
      expect(
        result.messages.find((m) => m.id === `${first.id}:reply`)
      ).toMatchObject({ recommendation: true, outdated: false })
      expect(
        result.messages.find((m) => m.id === `${next.id}:reply`)
      ).toMatchObject({
        recommendation: false,
        plan: intent === 'discuss' ? null : plan,
      })
    }
  )

  it.each([
    { context: { workspace: true, startSearch: true } },
    { context: { workspace: true }, confirmed: plan },
    { context: { workspace: true }, proposal: plan },
    { context: { workspace: true }, hasResult: true },
  ])('不将检索、已确认计划或修改建议误当成新推荐：%j', async (overrides) => {
    const result = await workspace([run(overrides)])
    expect(
      result.messages.find((m) => m.role === 'assistant')?.recommendation
    ).toBe(false)
  })
})
