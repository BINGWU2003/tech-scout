import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
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

describe('CatalogCompanyTable 公司表格', () => {
  it('渲染公司链接并保留分页导航', async () => {
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

    const companyLink = screen.getByRole('link', { name: 'Acme AI' })
    await expect
      .element(companyLink)
      .toHaveAttribute('href', '/catalog/companies/company-1')
    await expect.element(companyLink).toHaveClass('inline-block')
    await userEvent.hover(companyLink)
    await expect
      .element(screen.getByRole('tooltip'))
      .toHaveTextContent('Acme AI')
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
