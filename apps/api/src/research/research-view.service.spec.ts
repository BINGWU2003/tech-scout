import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../database/prisma.service.js'
import {
  ResearchViewService,
  patentStatsView,
  sourceView,
  subjectResolutionView,
} from './research-view.service.js'

describe('全部专利统计', () => {
  it('跨越分页汇总，同一篇的重复分类仅计一次，区分公开与授权年份', () => {
    const patents = Array.from({ length: 61 }, (_, i) => ({
      patent_id: `p${i}`,
      publication_year: 2025,
      grant_year: 2026,
      cpcs: ['G06V10/10', 'G06V20/20', 'H04N'],
    }))
    const stats = patentStatsView([
      ...patents,
      { patent_id: 'legacy', grant_year: 2025, cpcs: ['G06V'] },
      { patent_id: 'unknown', cpcs: [] },
    ])
    expect(stats).toEqual({
      total: 63,
      years: [
        { year: 2025, dateKind: 'grant', count: 1 },
        { year: 2025, dateKind: 'publication', count: 61 },
      ],
      unknownYearCount: 1,
      classifications: [
        { code: 'G06V', count: 62 },
        { code: 'H04N', count: 61 },
      ],
      unclassifiedCount: 1,
    })
  })
  it('空工作集没有虚构的年份或分类', () => {
    expect(patentStatsView([])).toEqual({
      total: 0,
      years: [],
      unknownYearCount: 0,
      classifications: [],
      unclassifiedCount: 0,
    })
  })
})

describe('研究来源链接', () => {
  it('只公开当前 Google Patents 与天眼查来源', () => {
    expect(
      sourceView({
        source_url: 'https://patents.google.com/patent/CN111370751B/zh',
      }).url
    ).toBe('https://patents.google.com/patent/CN111370751B/zh')
    expect(
      sourceView({
        source_url:
          'https://m.tianyancha.com/proxyPeers/getCompanyPhone.json?key=示例',
      }).url
    ).toContain('https://m.tianyancha.com/')
    expect(
      sourceView({ source_url: 'http://epub.cnipa.gov.cn/patent/CN1A' }).url
    ).toBeNull()
  })
})

describe('主体解析视图', () => {
  it('只公开输入工作集中的候选、选择和理由', () => {
    expect(
      subjectResolutionView(
        {
          assignee_id: 'assignee-1',
          status: 'matched',
          confidence: 'high',
          company_id: 'company-1',
          reason: '法定名称精确匹配',
        },
        [
          {
            assignee_id: 'assignee-1',
            name: '示例科技',
            patent_ids: ['CN1A', 'CN2A'],
            candidates: [{ company_id: 'company-1' }],
          },
        ],
        [{ company_id: 'company-1', preferred_name: '示例科技有限公司' }]
      )
    ).toEqual({
      id: 'assignee-1',
      name: '示例科技',
      status: 'matched',
      confidence: 'high',
      companyId: 'company-1',
      companyName: '示例科技有限公司',
      patentCount: 2,
      candidateCount: 1,
      candidates: [{ id: 'company-1', name: '示例科技有限公司' }],
      reason: '法定名称精确匹配',
    })
  })
})

describe('企业全量排行', () => {
  it('跨分页取前八名，并在读取时校验所有权', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      state: {
        artifacts: {
          snapshot: {
            companies: Array.from({ length: 40 }, (_, i) => ({
              company_id: `c${i}`,
              preferred_name: `公司${i}`,
            })),
          },
          companies: Array.from({ length: 40 }, (_, i) => ({
            company_id: `c${i}`,
            preferred_name: `公司${i}`,
            patent_ids: Array.from({ length: i + 1 }, (_, j) => `p${j}`),
          })),
        },
      },
    })
    const service = new ResearchViewService({
      researchRun: { findFirst },
    } as unknown as PrismaService)
    const stats = await service.companyStats('owner', 'run')
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'run', project: { userId: 'owner' } },
      select: { state: true },
    })
    expect(stats.total).toBe(40)
    expect(stats.ranking).toHaveLength(8)
    expect(stats.ranking[0]).toEqual({
      id: 'c39',
      name: '公司39',
      patentCount: 40,
    })
    findFirst.mockResolvedValue(null)
    await expect(service.companyStats('stranger', 'run')).rejects.toThrow(
      '研究运行不存在'
    )
  })
})
