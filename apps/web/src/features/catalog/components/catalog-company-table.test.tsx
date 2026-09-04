import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { CatalogCompanyTable } from './catalog-company-table'

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
    const screen = await render(
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

    await expect
      .element(screen.getByRole('link', { name: 'Acme AI' }))
      .toHaveAttribute('href', '/catalog/companies/company-1')
    await userEvent.click(screen.getByRole('button', { name: '前往第 2 页' }))
    expect(onQueryChange).toHaveBeenCalledWith({ page: 2 })
  })
})
