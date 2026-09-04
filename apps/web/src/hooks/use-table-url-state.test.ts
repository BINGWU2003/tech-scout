import { type Mock, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { type NavigateFn, useTableUrlState } from '@/hooks/use-table-url-state'

function lastNavigateOpts(navigate: Mock<NavigateFn>) {
  const calls = navigate.mock.calls
  return calls[calls.length - 1]?.[0]
}

function applyLastSearchFn(
  navigate: Mock<NavigateFn>,
  prev: Record<string, unknown>
) {
  const opts = lastNavigateOpts(navigate)
  if (!opts) return undefined
  const s = opts.search
  if (typeof s === 'function') {
    return s(prev) as Record<string, unknown>
  }
  return s as Record<string, unknown>
}

describe('useTableUrlState 表格 URL 状态', () => {
  it('使用默认值从搜索参数推导分页状态', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: { page: 3, pageSize: 25 },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    expect(result.current.pagination).toEqual({
      pageIndex: 2,
      pageSize: 25,
    })
  })

  it('在搜索参数缺少 page 和 pageSize 时使用默认值', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: {},
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    expect(result.current.pagination).toEqual({
      pageIndex: 0,
      pageSize: 10,
    })
  })

  it('通过 pageIndex 限制负数的有效页码', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: { page: 0 },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it('在分页值匹配默认值时通过 onPaginationChange 从搜索参数中省略 page 和 pageSize', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const prev = { page: 2, pageSize: 20, filter: 'q' }
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: prev,
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    await act(() => {
      result.current.onPaginationChange({
        pageIndex: 0,
        pageSize: 10,
      })
    })

    expect(applyLastSearchFn(navigate, prev)).toMatchObject({
      page: undefined,
      pageSize: undefined,
      filter: 'q',
    })
  })

  it('通过 onPaginationChange 写入非默认的 page 和 pageSize', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const prev = { filter: 'x' }
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { ...prev, page: 1, pageSize: 10 },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    await act(() => {
      result.current.onPaginationChange({
        pageIndex: 2,
        pageSize: 25,
      })
    })

    expect(applyLastSearchFn(navigate, prev)).toMatchObject({
      page: 3,
      pageSize: 25,
      filter: 'x',
    })
  })

  it('支持自定义分页搜索参数键', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: { p: 2, ps: 5 },
        navigate,
        pagination: {
          pageKey: 'p',
          pageSizeKey: 'ps',
          defaultPage: 1,
          defaultPageSize: 10,
        },
      })
    )

    expect(result.current.pagination).toEqual({
      pageIndex: 1,
      pageSize: 5,
    })
  })

  it('从搜索参数读取 globalFilter，并通过 onGlobalFilterChange 更新 URL 和清除 page', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { page: 2, filter: 'hello' },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        globalFilter: { enabled: true, key: 'filter' },
      })
    )

    expect(result.current.globalFilter).toBe('hello')

    await act(() => {
      result.current.onGlobalFilterChange?.('  next  ')
    })

    expect(applyLastSearchFn(navigate, { page: 2, filter: 'hello' })).toEqual({
      page: undefined,
      filter: 'next',
    })
  })

  it('在全局筛选值去除空白后为空时清除 URL 中的筛选键', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { filter: 'x' },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        globalFilter: { enabled: true, key: 'filter' },
      })
    )

    await act(() => {
      result.current.onGlobalFilterChange?.('   ')
    })

    expect(applyLastSearchFn(navigate, { filter: 'x' })).toMatchObject({
      filter: undefined,
    })
  })

  it('在 trim 为 false 时保留全局筛选值的空白', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: {},
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        globalFilter: { enabled: true, key: 'filter', trim: false },
      })
    )

    await act(() => {
      result.current.onGlobalFilterChange?.('  spaced  ')
    })

    expect(applyLastSearchFn(navigate, {})).toMatchObject({
      filter: '  spaced  ',
    })
  })

  it('在禁用全局筛选时省略 globalFilter 和 onGlobalFilterChange', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: { filter: 'ignored' },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        globalFilter: { enabled: false },
      })
    )

    expect(result.current.globalFilter).toBeUndefined()
    expect(result.current.onGlobalFilterChange).toBeUndefined()
  })

  it('从搜索参数构建数组类型的列筛选条件', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: { status: ['todo', 'done'], priority: ['high'] },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        columnFilters: [
          { columnId: 'status', searchKey: 'status', type: 'array' },
          { columnId: 'priority', searchKey: 'priority', type: 'array' },
        ],
      })
    )

    expect(result.current.columnFilters).toEqual([
      { id: 'status', value: ['todo', 'done'] },
      { id: 'priority', value: ['high'] },
    ])
  })

  it('从搜索参数构建字符串类型的列筛选条件', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result } = await renderHook(() =>
      useTableUrlState({
        search: { q: '  find me  ' },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        columnFilters: [{ columnId: 'title', searchKey: 'q', type: 'string' }],
      })
    )

    expect(result.current.columnFilters).toEqual([
      { id: 'title', value: '  find me  ' },
    ])
  })

  it('通过 onColumnFiltersChange 将序列化筛选条件合并到搜索参数并清除 page', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const prev = { page: 3, status: ['old'], other: 1 }
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: prev,
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        columnFilters: [
          { columnId: 'status', searchKey: 'status', type: 'array' },
          { columnId: 'priority', searchKey: 'priority', type: 'array' },
        ],
      })
    )

    await act(() => {
      result.current.onColumnFiltersChange([
        { id: 'status', value: ['todo'] },
        { id: 'priority', value: [] },
      ])
    })

    expect(applyLastSearchFn(navigate, prev)).toEqual({
      page: undefined,
      status: ['todo'],
      priority: undefined,
      other: 1,
    })
  })

  it('在当前页超过 pageCount 时通过 ensurePageInRange 使用 replace 导航', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { page: 5 },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    await act(() => {
      result.current.ensurePageInRange(2)
    })

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(lastNavigateOpts(navigate)?.replace).toBe(true)
    expect(applyLastSearchFn(navigate, { page: 5, filter: 'x' })).toMatchObject(
      {
        page: undefined,
        filter: 'x',
      }
    )
  })

  it('在 resetTo 为 last 时通过 ensurePageInRange 重置到最后一页', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { page: 9 },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    await act(() => {
      result.current.ensurePageInRange(3, { resetTo: 'last' })
    })

    expect(lastNavigateOpts(navigate)?.replace).toBe(true)
    expect(applyLastSearchFn(navigate, { page: 9 })).toMatchObject({
      page: 3,
    })
  })

  it('在页码有效时不通过 ensurePageInRange 导航', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { page: 2 },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
      })
    )

    await act(() => {
      result.current.ensurePageInRange(5)
    })

    expect(navigate).not.toHaveBeenCalled()
  })

  it('为列筛选条件使用自定义 serialize 和 deserialize', async () => {
    const navigate = vi.fn() as Mock<NavigateFn>
    const { result, act } = await renderHook(() =>
      useTableUrlState({
        search: { tag: 'a|b' },
        navigate,
        pagination: { defaultPage: 1, defaultPageSize: 10 },
        columnFilters: [
          {
            columnId: 'tag',
            searchKey: 'tag',
            type: 'array',
            deserialize: (v) => (typeof v === 'string' ? v.split('|') : []),
            serialize: (v) => (Array.isArray(v) ? v.join('|') : v),
          },
        ],
      })
    )

    expect(result.current.columnFilters).toEqual([
      { id: 'tag', value: ['a', 'b'] },
    ])

    await act(() => {
      result.current.onColumnFiltersChange([{ id: 'tag', value: ['x', 'y'] }])
    })

    expect(applyLastSearchFn(navigate, { tag: 'a|b' })).toMatchObject({
      tag: 'x|y',
    })
  })
})
