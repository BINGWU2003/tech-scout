import { describe, expect, it, vi } from 'vitest'
import { CatalogCompanyDetail } from './catalog-company-detail'
import { renderWithCatalogRouter } from './catalog-test-router'

const company = {
  companyId: 'company-1',
  preferredName: 'Acme AI',
  legalName: 'Acme AI, Inc.',
  country: 'US',
  provider: 'GLEIF',
  entityStatus: 'ACTIVE',
  aliases: [
    {
      aliasId: 'alias-1',
      name: 'Acme Artificial Intelligence',
      type: 'legal_name',
      provider: 'GLEIF',
    },
  ],
  externalIdentifiers: [
    {
      identifierId: 'identifier-1',
      type: 'LEI',
      value: 'TESTLEI000000000001',
      provider: 'GLEIF',
    },
  ],
  relationships: [
    {
      relationshipId: 'relationship-1',
      direction: 'outgoing' as const,
      relatedCompany: {
        companyId: 'company-2',
        preferredName: 'Acme Holdings',
        country: 'US',
      },
      relationshipType: 'IS_DIRECTLY_CONSOLIDATED_BY',
      relationshipStatus: 'ACTIVE',
      periodStartDate: null,
      periodEndDate: null,
      periodType: null,
      source: {
        locator: 'source-locator',
        dataset: 'gleif',
        relativePath: 'gleif/relationships.csv',
        sourceRowNumber: 5,
        sha256: 'a'.repeat(64),
        sourceRelease: 'gleif-v1',
        url: null,
      },
    },
  ],
  domainStats: [
    {
      domainId: 'ai_chips_edge_inference',
      domainName: 'AI chips and edge inference',
      patentCount: 2,
      latestPatentDate: '2025-01-03',
    },
  ],
  acceptedMatches: [
    {
      candidateId: 'candidate-1',
      representativeName: 'ACME AI INC',
      country: 'US',
      patentCount: 2,
      matchMethod: 'exact_alias',
      similarityScore: 1,
      decision: 'accepted',
      decisionReason: '官方名称一致',
      ruleVersion: 'match-v1',
    },
  ],
  source: {
    locator: 'company-source',
    dataset: 'gleif',
    relativePath: 'gleif/entities.csv',
    sourceRowNumber: 3,
    sha256: 'b'.repeat(64),
    sourceRelease: 'gleif-v1',
    url: null,
  },
}

describe('CatalogCompanyDetail 公司详情', () => {
  it('将公司身份与专利、关联关系和匹配证据联系起来', async () => {
    const screen = await renderWithCatalogRouter(
      <CatalogCompanyDetail company={company} />
    )

    await expect.element(screen.getByText('Acme AI, Inc.')).toBeInTheDocument()
    await expect
      .element(screen.getByText('TESTLEI000000000001'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: '查看全部专利' }))
      .toHaveAttribute('href', '/catalog/companies/company-1/patents')
    await expect
      .element(
        screen.getByRole('link', { name: /AI chips and edge inference/ })
      )
      .toHaveAttribute('href', '/catalog/companies/company-1/patents')
    await expect
      .element(screen.getByRole('link', { name: 'Acme Holdings' }))
      .toHaveAttribute('href', '/catalog/companies/company-2')
    await expect
      .element(screen.getByRole('link', { name: 'ACME AI INC' }))
      .toHaveAttribute('href', '/catalog/candidates/candidate-1')
  })

  it('通过页面导航状态打开指定领域的公司专利', async () => {
    const onDomainPatentsOpen = vi.fn()
    const screen = await renderWithCatalogRouter(
      <CatalogCompanyDetail
        company={company}
        onDomainPatentsOpen={onDomainPatentsOpen}
      />
    )

    await screen
      .getByRole('link', { name: /AI chips and edge inference/ })
      .click()

    expect(onDomainPatentsOpen).toHaveBeenCalledWith('ai_chips_edge_inference')
  })
})
