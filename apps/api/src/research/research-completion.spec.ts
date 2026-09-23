import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../database/prisma.service.js'
import type { IntelligenceClient } from './intelligence.client.js'
import { ResearchWorkspaceService } from './research-workspace.service.js'
import { ResearchService } from './research.service.js'

describe('研究完成后的服务端保护', () => {
  it('已开始检索但尚未完成时也不能创建追问', async () => {
    const projectId = randomUUID()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      researchProject: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspace: {} }),
      },
      researchRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi
          .fn()
          .mockImplementation(async ({ where }) =>
            where.OR ? { id: randomUUID() } : null
          ),
        create: vi.fn(),
      },
      researchCommand: { findFirst: vi.fn().mockResolvedValue(null) },
    }
    const research = new ResearchService(
      {
        $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
      } as unknown as PrismaService,
      {} as IntelligenceClient
    )
    vi.spyOn(research, 'project').mockResolvedValue({
      id: projectId,
      title: '',
      question: '',
      createdAt: new Date().toISOString(),
      runs: [],
    })
    await expect(
      research.newRun(randomUUID(), projectId, {
        requestKey: randomUUID(),
        question: '继续追问',
        thinking: false,
      })
    ).rejects.toThrow('技术方向已确认')
    expect(tx.researchRun.create).not.toHaveBeenCalled()
  })
  it.each([
    'completed',
    'empty',
    'awaiting_companies',
    'recoverable',
    'failed',
    'cancelled',
  ])('%s 后新请求不能启动、保存或应用计划', async (status) => {
    const projectId = randomUUID(),
      userId = randomUUID()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      researchRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi
          .fn()
          .mockImplementation(
            async ({ where }: { where: { OR?: unknown[] } }) =>
              where.OR ? { id: randomUUID(), status } : null
          ),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
      },
      researchCommand: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      researchProject: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspace: {} }),
        update: vi.fn(),
      },
    }
    const prisma = {
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    }
    const research = new ResearchService(
      prisma as unknown as PrismaService,
      {} as IntelligenceClient
    )
    vi.spyOn(research, 'project').mockResolvedValue({
      id: projectId,
      title: '',
      question: '',
      createdAt: new Date().toISOString(),
      runs: [],
    })
    await expect(
      research.newRun(
        userId,
        projectId,
        { requestKey: randomUUID(), question: '开始研究', thinking: false },
        0
      )
    ).rejects.toThrow('技术方向已确认')
    await expect(
      research.newRun(userId, projectId, {
        requestKey: randomUUID(),
        question: '继续追问',
        thinking: false,
      })
    ).rejects.toThrow('技术方向已确认')
    const workspace = new ResearchWorkspaceService(
      prisma as unknown as PrismaService,
      research
    )
    await expect(
      workspace.action(userId, projectId, {
        kind: 'save_plan',
        requestKey: randomUUID(),
        revision: 0,
        plan: {
          from_year: 2020,
          to_year: 2026,
          pages_per_keyword: 5,
          directions: [],
          risks: [],
        },
      })
    ).rejects.toThrow('技术方向已确认')
    await expect(
      workspace.action(userId, projectId, {
        kind: 'apply_proposal',
        requestKey: randomUUID(),
        revision: 0,
        proposalRunId: randomUUID(),
      })
    ).rejects.toThrow('技术方向已确认')
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4)
    expect(tx.researchRun.create).not.toHaveBeenCalled()
    expect(tx.researchProject.update).not.toHaveBeenCalled()
  })
})
