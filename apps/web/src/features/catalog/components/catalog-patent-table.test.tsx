import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { CatalogPatentTable } from './catalog-patent-table'

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
      patentId: 'patent-1',
      title: 'Edge neural accelerator',
      patentDate: '2025-01-03',
      grantYear: 2025,
      patentType: 'utility',
      wipoKind: 'B2',
      numClaims: 20,
      withdrawn: false,
      totalScore: 8,
      cpcGroups: ['G06N3/063'],
      assignees: ['Acme AI, Inc.'],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 41,
  totalPages: 3,
}

describe('CatalogPatentTable', () => {
  it('renders patent links and requests an explicit page', async () => {
    const onQueryChange = vi.fn()
    const screen = await render(
      <CatalogPatentTable
        result={result}
        query={{ page: 1, pageSize: 20, sort: 'score', order: 'desc' }}
        onQueryChange={onQueryChange}
      />
    )

    await expect
      .element(screen.getByRole('link', { name: 'Edge neural accelerator' }))
      .toHaveAttribute('href', '/catalog/patents/patent-1')
    await userEvent.click(screen.getByRole('button', { name: '前往第 2 页' }))
    expect(onQueryChange).toHaveBeenCalledWith({ page: 2 })
  })

  it('submits the complete patent filter set', async () => {
    const onQueryChange = vi.fn()
    const screen = await render(
      <CatalogPatentTable
        result={result}
        query={{ page: 1, pageSize: 20, sort: 'score', order: 'desc' }}
        onQueryChange={onQueryChange}
      />
    )

    await userEvent.fill(screen.getByLabelText('专利标题'), 'accelerator')
    await userEvent.fill(screen.getByLabelText('CPC 前缀'), 'g06n3')
    await userEvent.fill(screen.getByLabelText('受让人'), 'Acme')
    await userEvent.fill(screen.getByLabelText('起始年份'), '2020')
    await userEvent.fill(screen.getByLabelText('结束年份'), '2025')
    await userEvent.click(screen.getByRole('button', { name: '筛选' }))

    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      title: 'accelerator',
      cpcPrefix: 'g06n3',
      partyName: 'Acme',
      fromYear: 2020,
      toYear: 2025,
    })
  })
})
