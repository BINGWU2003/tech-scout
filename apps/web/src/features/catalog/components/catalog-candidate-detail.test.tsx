import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { CatalogCandidateDetail } from './catalog-candidate-detail'

const candidate = {
  candidateId: 'candidate-3',
  representativeName: 'JANE DOE',
  country: 'US',
  patentCount: 1,
  partyRowCount: 2,
  rawNameVariantCount: 1,
  decision: {
    value: 'rejected',
    organizationType: 'individual',
    selectedCompanyId: null,
    reviewMethod: 'manual',
    reviewedAt: '2026-09-01T00:00:00.000Z',
    reviewer: 'reviewer@example.com',
    note: '个人申请人，不纳入公司目录',
  },
  suggestions: [
    {
      matchId: 'match-1',
      suggestedCompanyId: 'company-1',
      suggestedName: 'Acme AI',
      provider: 'GLEIF',
      matchMethod: 'fuzzy_name',
      similarityScore: 0.82,
      decision: 'rejected',
      decisionReason: '主体不一致',
      accepted: false,
    },
  ],
  evidenceCount: 21,
}

const evidence = {
  release: {
    releaseId: 'test-v1',
    dataset: 'ai-domains',
    generatedAt: '2026-09-01T00:00:00.000Z',
    publishedAt: '2026-09-01T01:00:00.000Z',
    periodFromYear: 2019,
    periodToYear: 2025,
    unavailableFields: [],
  },
  items: [
    {
      evidenceId: 'evidence-2',
      candidateId: 'candidate-3',
      publisher: 'USPTO',
      sourceType: 'official_record',
      sourceUrl: 'https://example.com/evidence/2',
      observedAt: '2026-08-31T00:00:00.000Z',
      legalName: 'Jane Doe',
      country: 'US',
      identifierType: null,
      identifierValue: null,
      preserved: true,
      contentSha256: 'a'.repeat(64),
      source: {
        locator: 'evidence-source',
        dataset: 'review',
        relativePath: 'reviews/test/evidence.jsonl',
        sourceRowNumber: 2,
        sha256: 'b'.repeat(64),
        sourceRelease: 'review-v1',
        url: null,
      },
    },
  ],
  page: 1,
  pageSize: 20,
  total: 21,
  totalPages: 2,
}

describe('CatalogCandidateDetail 候选项详情', () => {
  it('显示最终决策、建议和分页证据', async () => {
    const onPageChange = vi.fn()
    const screen = await render(
      <CatalogCandidateDetail
        candidate={candidate}
        evidence={evidence}
        onPageChange={onPageChange}
      />
    )

    await expect.element(screen.getByText('rejected')).toBeInTheDocument()
    await expect
      .element(screen.getByText('个人申请人，不纳入公司目录'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Acme AI' }))
      .toHaveAttribute('href', '/catalog/companies/company-1')
    await expect
      .element(screen.getByRole('link', { name: '查看证据' }))
      .toHaveAttribute('href', 'https://example.com/evidence/2')
    await userEvent.click(screen.getByRole('button', { name: '前往第 2 页' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
