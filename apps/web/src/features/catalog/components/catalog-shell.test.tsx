import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { CatalogDomainTabs } from './catalog-shell'

function createTestRouter() {
  const rootRoute = createRootRoute()
  const companiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/catalog/domains/$domainId/companies',
    component: () => (
      <CatalogDomainTabs
        domainId='ai_chips_edge_inference'
        active='companies'
      />
    ),
  })
  const patentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/catalog/domains/$domainId/patents',
    component: () => <div>专利页面</div>,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([companiesRoute, patentsRoute]),
    history: createMemoryHistory({
      initialEntries: ['/catalog/domains/ai_chips_edge_inference/companies'],
    }),
  })
}

describe('CatalogDomainTabs 领域目录切换', () => {
  it('点击内部链接时通过客户端路由切换页面', async () => {
    const router = createTestRouter()
    const screen = await render(<RouterProvider router={router} />)
    let routerHandledClick = false

    document.addEventListener(
      'click',
      (event) => {
        routerHandledClick = event.defaultPrevented
        event.preventDefault()
      },
      { once: true }
    )

    await userEvent.click(screen.getByRole('link', { name: '专利' }))

    expect(routerHandledClick).toBe(true)
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/catalog/domains/ai_chips_edge_inference/patents')
  })
})
