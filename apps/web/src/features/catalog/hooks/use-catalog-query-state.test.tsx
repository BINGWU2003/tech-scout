import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { catalogCompanyListQuerySchema } from '@tech-scout/contracts'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { useCatalogQueryState } from './use-catalog-query-state'

function QueryHarness() {
  const { query, updateQuery } = useCatalogQueryState(
    catalogCompanyListQuerySchema
  )

  return (
    <>
      <output aria-label='当前查询'>{JSON.stringify(query)}</output>
      <button type='button' onClick={() => updateQuery({ page: 3 })}>
        跳到第 3 页
      </button>
    </>
  )
}

function createTestRouter(initialEntry = '/catalog', catalogQuery?: unknown) {
  const rootRoute = createRootRoute()
  const catalogRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/catalog',
    component: QueryHarness,
  })
  const history = createMemoryHistory({ initialEntries: [initialEntry] })
  if (catalogQuery !== undefined) {
    history.replace(initialEntry, { catalogQuery })
  }
  const router = createRouter({
    routeTree: rootRoute.addChildren([catalogRoute]),
    history,
  })

  return router
}

describe('Catalog 查询历史状态', () => {
  it('从 Contracts schema 取得默认查询状态', async () => {
    const router = createTestRouter()
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent(
        '{"page":1,"pageSize":20,"sort":"patentCount","order":"desc"}'
      )
  })

  it('更新查询时保持干净 URL 并写入当前历史记录', async () => {
    const router = createTestRouter()
    const screen = await render(<RouterProvider router={router} />)

    await screen.getByRole('button', { name: '跳到第 3 页' }).click()

    await expect.poll(() => router.state.location.href).toBe('/catalog')
    expect(router.state.location.state).toMatchObject({
      catalogQuery: {
        page: 3,
        pageSize: 20,
        sort: 'patentCount',
        order: 'desc',
      },
    })
  })

  it('恢复当前历史记录中符合契约的查询状态', async () => {
    const router = createTestRouter('/catalog', {
      page: 4,
      pageSize: 50,
      sort: 'name',
      order: 'asc',
    })
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent('{"page":4,"pageSize":50,"sort":"name","order":"asc"}')
  })

  it('在历史状态不符合契约时恢复默认查询', async () => {
    const router = createTestRouter('/catalog', { page: 0 })
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent(
        '{"page":1,"pageSize":20,"sort":"patentCount","order":"desc"}'
      )
  })

  it('清理旧查询 URL 并重置为默认状态', async () => {
    const router = createTestRouter(
      '/catalog?page=4&pageSize=50&sort=name&order=asc',
      {
        page: 3,
        pageSize: 100,
        sort: 'latestPatentDate',
        order: 'asc',
      }
    )
    const screen = await render(<RouterProvider router={router} />)

    await expect.poll(() => router.state.location.href).toBe('/catalog')
    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent(
        '{"page":1,"pageSize":20,"sort":"patentCount","order":"desc"}'
      )
    expect(router.history.length).toBe(1)
  })
})
