import { randomUUID } from 'node:crypto'
import { researchKeywordRequestSchema } from '@tech-scout/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../database/prisma.service.js'
import type { IntelligenceClient } from './intelligence.client.js'
import { ResearchService } from './research.service.js'

describe('关键词生成与启动保护', () => {
  it('生成请求拒绝空名称或描述', () => {
    expect(
      researchKeywordRequestSchema.safeParse({
        requestKey: randomUUID(),
        direction: { domain_id: 'manual', name: '视觉', explanation: ' ' },
      }).success
    ).toBe(false)
  })

  it('空关键词不能创建检索运行', async () => {
    const projectId = randomUUID()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      researchProject: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          workspace: {
            revision: 1,
            selectedPlan: {
              from_year: 2020,
              to_year: 2026,
              pages_per_keyword: 5,
              risks: [],
              directions: [
                {
                  domain_id: 'manual',
                  name: '视觉',
                  explanation: '缺陷检测',
                  keywords: [],
                  excluded_keywords: [],
                  cpc_prefixes: [],
                },
              ],
            },
          },
        }),
      },
      researchRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
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
      research.newRun(
        randomUUID(),
        projectId,
        { requestKey: randomUUID(), question: '开始研究', thinking: false },
        1
      )
    ).rejects.toThrow('至少需要一个检索关键词')
    expect(tx.researchRun.create).not.toHaveBeenCalled()
  })
})
