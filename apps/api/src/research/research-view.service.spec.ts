import { describe, expect, it } from 'vitest'
import {
  candidateView,
  patentStatsView,
  sourceView,
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

describe('待核对主体国家', () => {
  it('公开建议国家及其证据来源，但不把它标记为已确认', () => {
    expect(
      candidateView({
        candidate_id: 'candidate-1',
        name: '示例科技有限公司',
        country: 'CN',
        country_status: 'suggested',
        country_source: 'tianyancha',
        status: 'unverified',
        requires_confirmation: true,
        terminal_exclusion: false,
        patent_ids: ['CN1A', 'CN2A'],
      })
    ).toMatchObject({
      country: 'CN',
      countryStatus: 'suggested',
      countrySource: 'tianyancha',
      patentCount: 2,
    })
  })

  it('从旧快照已有的单一登记证据恢复建议国家', () => {
    expect(
      candidateView({
        candidate_id: 'legacy-candidate',
        name: '旧快照企业',
        country: null,
        evidence: [{ country: 'CN', publisher: 'tianyancha' }],
        status: 'unverified',
        requires_confirmation: true,
        terminal_exclusion: false,
        patent_ids: ['CN1A'],
      })
    ).toMatchObject({
      country: 'CN',
      countryStatus: 'suggested',
      countrySource: 'tianyancha',
    })
  })

  it('将旧快照直接提供的国家标记为专利来源确认值', () => {
    expect(
      candidateView({
        candidate_id: 'legacy-patent-country',
        name: 'Acme',
        country: 'US',
        status: 'unverified',
        requires_confirmation: true,
        terminal_exclusion: false,
        patent_ids: ['US1A'],
      })
    ).toMatchObject({
      country: 'US',
      countryStatus: 'verified',
      countrySource: 'patent',
    })
  })
})
