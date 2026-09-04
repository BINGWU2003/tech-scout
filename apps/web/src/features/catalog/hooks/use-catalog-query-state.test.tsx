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

function createTestRouter(initialEntry = '/catalog') {
  const rootRoute = createRootRoute()
  const catalogRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/catalog',
    component: QueryHarness,
  })
  const history = createMemoryHistory({ initialEntries: [initialEntry] })
  const router = createRouter({
    routeTree: rootRoute.addChildren([catalogRoute]),
    history,
  })

  return router
}

describe('Catalog URL 查询状态', () => {
  it('从 Contracts schema 取得默认查询状态', async () => {
    const router = createTestRouter()
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent(
        '{"page":1,"pageSize":20,"sort":"patentCount","order":"desc"}'
      )
  })

  it('更新查询时将表格状态写入 URL', async () => {
    const router = createTestRouter()
    const screen = await render(<RouterProvider router={router} />)

    await screen.getByRole('button', { name: '跳到第 3 页' }).click()

    await expect.poll(() => router.state.location.href).toBe('/catalog?page=3')
  })

  it('从 URL 恢复符合契约的表格状态', async () => {
    const router = createTestRouter(
      '/catalog?page=4&pageSize=50&sort=name&order=asc'
    )
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent('{"page":4,"pageSize":50,"sort":"name","order":"asc"}')
  })

  it('没有 URL 查询参数时恢复默认查询', async () => {
    const router = createTestRouter('/catalog')
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent(
        '{"page":1,"pageSize":20,"sort":"patentCount","order":"desc"}'
      )
  })

  it('URL 查询参数无效时恢复默认状态', async () => {
    const router = createTestRouter(
      '/catalog?page=0&pageSize=500&sort=unknown&order=asc'
    )
    const screen = await render(<RouterProvider router={router} />)

    await expect
      .element(screen.getByLabelText('当前查询'))
      .toHaveTextContent(
        '{"page":1,"pageSize":20,"sort":"patentCount","order":"desc"}'
      )
  })
})
