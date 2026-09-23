import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../database/prisma.service.js'
import {
  ResearchViewService,
  patentStatsView,
  sourceView,
  companyLeadRelations,
  resultView,
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

describe('企业查询线索', () => {
  it('同一权利人命中多家企业，均保留专利线索且不宣称权属', () => {
    const artifacts = {
      patents: [{ patent_id: 'CN1A' }],
      assignees: [
        { assignee_id: 'a1', name: '示例科技有限公司', patent_ids: ['CN1A'] },
      ],
      snapshot: {
        companies: [
          { company_id: 'c1', legal_name: '示例科技有限公司' },
          { company_id: 'c2', legal_name: '示例科技集团有限公司' },
        ],
        'company-aliases': [],
        'company-search-hits': [
          { company_id: 'c1', assignee_id: 'a1' },
          { company_id: 'c2', assignee_id: 'a1' },
        ],
      },
    }
    expect(companyLeadRelations(artifacts, 'c1')).toEqual([
      {
        patentId: 'CN1A',
        assigneeName: '示例科技有限公司',
        basis: 'legal_name',
      },
    ])
    expect(companyLeadRelations(artifacts, 'c2')).toEqual([
      {
        patentId: 'CN1A',
        assigneeName: '示例科技有限公司',
        basis: 'search_hit',
      },
    ])
  })
})

describe('新版报告投影', () => {
  it('分别呈现全部专利与企业优先级，不输出权属推断', () => {
    const result = resultView({
      release_id: 'release-1',
      patent_count: 1,
      missing: [],
      patents: [{ patent_id: 'CN1A', priority: 'high', reason: '技术相关' }],
      companies: [
        {
          company_id: 'c1',
          preferred_name: '示例公司',
          country: 'CN',
          priority: 'medium',
          summary: '值得核实',
          patent_ids: ['CN1A'],
          relations: [{ patent_id: 'CN1A', assignee_name: '示例权利人' }],
        },
      ],
    })
    expect(result.patents).toEqual([
      { id: 'CN1A', priority: 'high', reason: '技术相关' },
    ])
    expect(result.companies[0]).toMatchObject({
      priority: 'medium',
      leadPatentCount: 1,
      assigneeNames: ['示例权利人'],
    })
    expect(result.companies[0]).not.toHaveProperty('resolutionKind')
  })
})

describe('企业全量排行', () => {
  it('跨分页取前八名，并在读取时校验所有权', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      state: {
        artifacts: {
          execution_config: { workflow_version: 'browser-v3' },
          patents: Array.from({ length: 40 }, (_, i) => ({
            patent_id: `p${i}`,
          })),
          assignees: Array.from({ length: 40 }, (_, i) => ({
            assignee_id: `a${i}`,
            name: `权利人${i}`,
            patent_ids: Array.from({ length: i + 1 }, (_, j) => `p${j}`),
          })),
          snapshot: {
            companies: Array.from({ length: 40 }, (_, i) => ({
              company_id: `c${i}`,
              preferred_name: `公司${i}`,
              legal_name: `公司${i}`,
            })),
            'company-aliases': [],
            'company-search-hits': Array.from({ length: 40 }, (_, i) => ({
              company_id: `c${i}`,
              assignee_id: `a${i}`,
            })),
          },
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
