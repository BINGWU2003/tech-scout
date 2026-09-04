import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCompanyTable } from './catalog-company-table'
import { renderWithCatalogRouter } from './catalog-test-router'

const result = {
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
      companyId: 'company-1',
      preferredName: 'Acme AI',
      legalName: 'Acme AI, Inc.',
      country: 'US',
      provider: 'GLEIF',
      entityStatus: 'ACTIVE',
      patentCount: 2,
      latestPatentDate: '2025-01-03',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 22,
  totalPages: 2,
}

const detailResponse = {
  release: result.release,
  company: {
    companyId: 'company-1',
    preferredName: 'Acme AI',
    legalName: 'Acme AI, Inc.',
    country: 'US',
    provider: 'GLEIF',
    entityStatus: 'ACTIVE',
    aliases: [],
    externalIdentifiers: [],
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
          locator: 'relationship-source',
          dataset: 'gleif',
          relativePath: 'gleif/relationships.csv',
          sourceRowNumber: 5,
          sha256: 'b'.repeat(64),
          sourceRelease: 'gleif-v1',
          url: null,
        },
      },
    ],
    domainStats: [],
    acceptedMatches: [],
    source: {
      locator: 'company-source',
      dataset: 'gleif',
      relativePath: 'gleif/entities.csv',
      sourceRowNumber: 3,
      sha256: 'a'.repeat(64),
      sourceRelease: 'gleif-v1',
      url: null,
    },
  },
}

const relatedDetailResponse = {
  release: result.release,
  company: {
    ...detailResponse.company,
    companyId: 'company-2',
    preferredName: 'Acme Holdings',
    legalName: 'Acme Holdings LLC',
    relationships: [],
  },
}

afterEach(() => vi.restoreAllMocks())

describe('CatalogCompanyTable 公司表格', () => {
  it('在当前页面的 Dialog 中加载公司详情并保留分页导航', async () => {
    const onQueryChange = vi.fn()
    const companyRequest = vi
      .spyOn(catalogApi, 'company')
      .mockResolvedValue(detailResponse)
    const screen = await renderWithCatalogRouter(
      <CatalogCompanyTable
        result={result}
        query={{
          page: 1,
          pageSize: 20,
          sort: 'patentCount',
          order: 'desc',
        }}
        onQueryChange={onQueryChange}
      />
    )

    const companyButton = screen.getByRole('button', { name: 'Acme AI' })
    await expect
      .element(screen.getByRole('link', { name: 'Acme AI' }))
      .not.toBeInTheDocument()
    await userEvent.hover(companyButton)
    await expect
      .element(screen.getByRole('tooltip'))
      .toHaveTextContent('Acme AI')
    const initialHref = screen.router.state.location.href
    await userEvent.click(companyButton)
    await expect.element(screen.getByRole('dialog')).toBeInTheDocument()
    await expect
      .element(screen.getByText('公司身份', { exact: true }))
      .toBeInTheDocument()
    expect(companyRequest).toHaveBeenCalledWith('company-1')
    expect(screen.router.state.location.href).toBe(initialHref)
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(companyButton).toHaveFocus()
    await expect
      .element(screen.getByRole('button', { name: '搜索' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('group', { name: '公司搜索条件' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('group', { name: '公司排序' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('共 22 家已确认公司'))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '前往第 2 页' }))
    expect(onQueryChange).toHaveBeenCalledWith({ page: 2 })
  })

  it('在同一 Dialog 中打开关联公司并返回上一家公司', async () => {
    const companyRequest = vi
      .spyOn(catalogApi, 'company')
      .mockImplementation((companyId) =>
        Promise.resolve(
          companyId === 'company-2' ? relatedDetailResponse : detailResponse
        )
      )
    const screen = await renderWithCatalogRouter(
      <CatalogCompanyTable
        result={result}
        query={{
          page: 1,
          pageSize: 20,
          sort: 'patentCount',
          order: 'desc',
        }}
        onQueryChange={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Acme AI' }))
    await userEvent.click(
      await screen.getByRole('button', { name: 'Acme Holdings' })
    )
    await expect
      .element(screen.getByRole('heading', { name: 'Acme Holdings' }))
      .toBeInTheDocument()
    expect(companyRequest).toHaveBeenCalledWith('company-2')

    await userEvent.click(
      screen.getByRole('button', { name: '返回上一家公司' })
    )
    await expect
      .element(screen.getByRole('heading', { name: 'Acme AI' }))
      .toBeInTheDocument()
  })

  it('仅在存在搜索条件时显示重置按钮', async () => {
    const onQueryChange = vi.fn()
    const screen = await renderWithCatalogRouter(
      <CatalogCompanyTable
        result={result}
        query={{
          page: 1,
          pageSize: 20,
          sort: 'patentCount',
          order: 'desc',
        }}
        onQueryChange={onQueryChange}
      />
    )

    await userEvent.fill(screen.getByLabelText('国家或地区代码'), 'CN')
    expect(onQueryChange).not.toHaveBeenCalled()
    await expect
      .poll(() => onQueryChange.mock.lastCall?.[0])
      .toEqual({ page: 1, country: 'CN' })
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '重置' }))

    await expect
      .element(screen.getByLabelText('国家或地区代码'))
      .toHaveValue('')
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .not.toBeInTheDocument()
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      query: undefined,
      country: undefined,
    })
  })
})
