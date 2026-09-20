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

async function workspace(
  runs: ReturnType<typeof run>[],
  commands: Record<string, unknown>[] = []
) {
  const prisma = {
    researchProject: {
      findFirst: vi.fn().mockResolvedValue({ workspace: {} }),
    },
    $queryRaw: vi.fn().mockResolvedValue(runs),
    researchCommand: {
      findMany: vi.fn().mockResolvedValue(commands),
      count: vi.fn().mockResolvedValue(0),
    },
  }
  return new ResearchWorkspaceService(
    prisma as unknown as PrismaService,
    {} as ResearchService
  ).get(randomUUID(), randomUUID())
}

describe('多轮推荐卡片', () => {
  it.each([
    ['start_companies', 'companies'],
    ['resolve_entities', 'report'],
  ])('隐藏 %s 操作消息但保留阶段进度', async (kind, stage) => {
    const current = run({ status: 'awaiting_companies', confirmed: plan })
    const command = {
      id: randomUUID(),
      runId: current.id,
      payload: { kind },
      createdAt: new Date(),
    }
    const result = await workspace([current], [command])
    expect(result.messages.some((message) => message.id === command.id)).toBe(
      false
    )
    expect(result.messages.length).toBeGreaterThan(0)
    expect(result.reachedStage).toBe(stage)
    expect(result.currentStageStatus).toBe('queued')
  })
  it.each(['confirm_plan', 'retry', 'pause', 'cancel'])(
    '隐藏 %s 操作消息',
    async (kind) => {
      const current = run()
      const command = {
        id: randomUUID(),
        runId: current.id,
        payload: { kind },
        createdAt: new Date(),
      }
      const result = await workspace([current], [command])
      expect(result.messages.some((message) => message.id === command.id)).toBe(
        false
      )
    }
  )
  it('隐藏开始检索产生的合成问答，但保留运行进度', async () => {
    const execution = run({
      context: { workspace: true, startSearch: true },
      status: 'running',
      confirmed: plan,
      hasResult: true,
    })
    const result = await workspace([execution])
    expect(result.messages).toEqual([])
    expect(result).toMatchObject({
      activeRunId: execution.id,
      executionRunId: execution.id,
      reachedStage: 'report',
    })
  })
  it('把真实提问后的未完成回复标记为失败反馈', async () => {
    const failed = run({
      status: 'failed',
      plan: null,
      reply: null,
      intent: null,
      reasoning: {
        id: randomUUID(),
        status: 'interrupted',
        text: '正在分析',
        startedAt: '2026-09-12T00:00:00Z',
        durationMs: 1000,
        truncated: false,
      },
    })
    const result = await workspace([failed])
    expect(
      result.messages.find((message) => message.id === `${failed.id}:reply`)
    ).toMatchObject({
      failed: true,
      text: '本次回复未完成，可重试。',
    })
  })
  it.each(['completed', 'empty'])(
    '历史 %s 后继续对话不会解锁研究',
    async (status) => {
      const completed = run({ status, confirmed: plan, hasResult: true })
      const result = await workspace([
        completed,
        run({ createdAt: new Date('2026-09-12T00:01:00Z') }),
      ])
      expect(result.researchCompleted).toBe(true)
      expect(result.reachedStage).toBe('report')
    }
  )
  it.each(['failed', 'cancelled', 'recoverable'])(
    '%s 保留已到达的步骤并允许重试',
    async (status) => {
      const result = await workspace([
        run({ status, node: 'company', confirmed: plan }),
      ])
      expect(result.researchCompleted).toBe(false)
      expect(result.reachedStage).toBe('companies')
    }
  )
  it('专利已完成仍需显式开始企业发现', async () => {
    const result = await workspace([
      run({
        status: 'awaiting_companies',
        node: 'company_gate',
        confirmed: plan,
      }),
    ])
    expect(result.reachedStage).toBe('patents')
    expect(result.currentStageStatus).toBe('completed')
  })
  it('旧轮次的进度与启动命令不解锁当前轮次的企业步骤', async () => {
    const previous = run({ status: 'failed', node: 'company', confirmed: plan })
    const current = run({
      status: 'awaiting_companies',
      node: 'company_gate',
      confirmed: plan,
    })
    const result = await workspace(
      [previous, current],
      [
        {
          id: randomUUID(),
          runId: previous.id,
          payload: { kind: 'resolve_entities' },
          createdAt: new Date(),
        },
      ]
    )
    expect(result).toMatchObject({
      executionRunId: current.id,
      reachedStage: 'patents',
      currentStageStatus: 'completed',
    })
  })
  it('后续追问不会抢占执行中的当前步骤', async () => {
    const execution = run({
      status: 'running',
      node: 'company',
      confirmed: plan,
    })
    const result = await workspace([execution, run()])
    expect(result).toMatchObject({
      executionRunId: execution.id,
      reachedStage: 'companies',
      currentStageStatus: 'running',
    })
  })
  it('新轮次启动已受理但快照尚未更新时，使用新轮次的排队进度', async () => {
    const previous = run({ status: 'failed', node: 'company', confirmed: plan })
    const current = run({ node: 'plan_gate' })
    const result = await workspace(
      [previous, current],
      [
        {
          id: randomUUID(),
          runId: current.id,
          payload: { kind: 'confirm_plan' },
          createdAt: new Date(),
        },
      ]
    )
    expect(result).toMatchObject({
      executionRunId: current.id,
      reachedStage: 'patents',
      currentStageStatus: 'queued',
    })
  })
  it.each([
    ['queued', null, 'queued'],
    ['running', null, 'running'],
    ['recoverable', null, 'paused'],
    ['recoverable', 'company', 'failed'],
    ['failed', 'company', 'failed'],
    ['cancelled', null, 'cancelled'],
    ['awaiting_entities', null, 'awaiting_confirmation'],
  ])(
    '企业步骤 %s 显示 %s 对应的真实状态 %s',
    async (status, errorNode, label) => {
      const result = await workspace([
        run({
          status,
          errorNode,
          node: 'company',
          confirmed: plan,
        }),
      ])
      expect(result.reachedStage).toBe('companies')
      expect(result.currentStageStatus).toBe(label)
    }
  )
  it('空计划保留可访问的初始步骤', async () => {
    const result = await workspace([])
    expect(result).toMatchObject({
      reachedStage: 'plan',
      currentStageStatus: 'draft',
      executionRunId: null,
    })
  })
  it('开始企业查询后尚未更新节点便暂停，仍保留企业步骤和暂停状态', async () => {
    const current = run({
      status: 'recoverable',
      node: 'company_gate',
      confirmed: plan,
    })
    const result = await workspace(
      [current],
      [
        {
          id: randomUUID(),
          runId: current.id,
          payload: { kind: 'start_companies' },
          createdAt: new Date(),
        },
      ]
    )
    expect(result).toMatchObject({
      reachedStage: 'companies',
      currentStageStatus: 'paused',
    })
  })
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
