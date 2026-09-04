import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { CatalogPatentTable } from './catalog-patent-table'
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
      patentId: 'patent-1',
      title: 'Edge neural accelerator',
      patentDate: '2025-01-03',
      grantYear: 2025,
      patentType: 'utility',
      wipoKind: 'B2',
      numClaims: 20,
      withdrawn: false,
      totalScore: 8,
      cpcGroups: ['G06N3/063', 'G06T2207/10152', 'H10B61/00'],
      assignees: ['Acme AI, Inc.'],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 41,
  totalPages: 3,
}

describe('CatalogPatentTable 专利表格', () => {
  it('渲染专利链接并请求指定页码', async () => {
    const onQueryChange = vi.fn()
    const screen = await renderWithCatalogRouter(
      <CatalogPatentTable
        result={result}
        query={{ page: 1, pageSize: 20, sort: 'score', order: 'desc' }}
        onQueryChange={onQueryChange}
      />
    )

    const patentLink = screen.getByRole('link', {
      name: 'Edge neural accelerator',
    })
    await expect
      .element(patentLink)
      .toHaveAttribute('href', '/catalog/patents/patent-1')
    await expect.element(patentLink).toHaveClass('inline-block')
    await userEvent.hover(patentLink)
    await expect
      .element(screen.getByRole('tooltip'))
      .toHaveTextContent('Edge neural accelerator')
    await expect
      .element(screen.getByRole('group', { name: '专利搜索条件' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('group', { name: '专利排序' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '搜索' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('共 41 件专利'))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '前往第 2 页' }))
    expect(onQueryChange).toHaveBeenCalledWith({ page: 2 })
  })

  it('仅在存在搜索条件时显示重置按钮', async () => {
    const onQueryChange = vi.fn()
    const screen = await renderWithCatalogRouter(
      <CatalogPatentTable
        result={result}
        query={{ page: 1, pageSize: 20, sort: 'score', order: 'desc' }}
        onQueryChange={onQueryChange}
      />
    )

    await userEvent.fill(screen.getByLabelText('专利标题'), 'accelerator')
    expect(onQueryChange).not.toHaveBeenCalled()
    await expect
      .poll(() => onQueryChange.mock.lastCall?.[0])
      .toEqual({ page: 1, title: 'accelerator' })
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '重置' }))

    await expect.element(screen.getByLabelText('专利标题')).toHaveValue('')
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .not.toBeInTheDocument()
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      title: undefined,
      cpcPrefix: undefined,
      partyName: undefined,
      fromYear: undefined,
      toYear: undefined,
    })
  })

  it('使用首项和数量简洁显示多个 CPC', async () => {
    const screen = await renderWithCatalogRouter(
      <CatalogPatentTable
        result={result}
        query={{ page: 1, pageSize: 20, sort: 'score', order: 'desc' }}
        onQueryChange={vi.fn()}
      />
    )

    const firstCpc = screen.getByText('G06N3/063')
    await expect.element(firstCpc).toBeInTheDocument()
    await expect.element(screen.getByText('+2')).toBeInTheDocument()
    await expect
      .element(screen.getByText('G06T2207/10152'))
      .not.toBeInTheDocument()

    await userEvent.hover(firstCpc)
    await expect
      .element(screen.getByRole('tooltip'))
      .toHaveTextContent('G06N3/063、G06T2207/10152、H10B61/00')
  })

  it('输入和选择年份时立即更新专利查询条件', async () => {
    const onQueryChange = vi.fn()
    const screen = await renderWithCatalogRouter(
      <CatalogPatentTable
        result={result}
        query={{ page: 1, pageSize: 20, sort: 'score', order: 'desc' }}
        onQueryChange={onQueryChange}
      />
    )

    await userEvent.fill(screen.getByLabelText('专利标题'), 'accelerator')
    await userEvent.fill(screen.getByLabelText('CPC 前缀'), 'g06n3')
    await userEvent.fill(screen.getByLabelText('受让人'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: '授权年份' }))
    await userEvent.click(screen.getByRole('button', { name: '选择 2025 年' }))
    await expect
      .element(screen.getByRole('button', { name: '授权年份：2025 年起' }))
      .toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '选择 2029 年' }))
    await expect
      .element(screen.getByRole('button', { name: '授权年份：2025 – 2029' }))
      .toBeInTheDocument()
    await expect
      .poll(() =>
        onQueryChange.mock.calls.some(
          ([patch]) => patch.title === 'accelerator'
        )
      )
      .toBe(true)
    await expect
      .poll(() =>
        onQueryChange.mock.calls.some(([patch]) => patch.cpcPrefix === 'g06n3')
      )
      .toBe(true)
    await expect
      .poll(() =>
        onQueryChange.mock.calls.some(([patch]) => patch.partyName === 'Acme')
      )
      .toBe(true)
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      title: 'accelerator',
    })
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      cpcPrefix: 'g06n3',
    })
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      partyName: 'Acme',
    })
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      fromYear: 2025,
      toYear: undefined,
    })
    expect(onQueryChange).toHaveBeenCalledWith({
      page: 1,
      fromYear: 2025,
      toYear: 2029,
    })
  })

  it('清除已选的授权年份范围', async () => {
    const onQueryChange = vi.fn()
    const screen = await renderWithCatalogRouter(
      <CatalogPatentTable
        result={result}
        query={{
          page: 1,
          pageSize: 20,
          sort: 'score',
          order: 'desc',
          fromYear: 2020,
          toYear: 2025,
        }}
        onQueryChange={onQueryChange}
      />
    )

    await userEvent.click(
      screen.getByRole('button', { name: '授权年份：2020 – 2025' })
    )
    await userEvent.click(screen.getByRole('button', { name: '清除年份' }))
    await expect
      .element(screen.getByRole('button', { name: '授权年份' }))
      .toBeInTheDocument()

    expect(onQueryChange).toHaveBeenLastCalledWith({
      page: 1,
      fromYear: undefined,
      toYear: undefined,
    })
  })
})
