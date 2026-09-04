import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCompaniesPage } from './catalog-company-pages'

vi.mock('@/lib/catalog-api', () => ({
  catalogApi: { companies: vi.fn() },
}))

const response = {
  release: {
    releaseId: 'test-v1',
    dataset: 'ai-domains',
    generatedAt: '2026-09-01T00:00:00.000Z',
    publishedAt: '2026-09-01T01:00:00.000Z',
    periodFromYear: 2019,
    periodToYear: 2025,
    unavailableFields: ['abstract'],
  },
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
}

function createCompaniesRouter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute()
  const companiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/catalog/companies',
    component: () => (
      <QueryClientProvider client={client}>
        <DirectionProvider>
          <ThemeProvider>
            <SearchProvider>
              <LayoutProvider>
                <SidebarProvider>
                  <CatalogCompaniesPage />
                </SidebarProvider>
              </LayoutProvider>
            </SearchProvider>
          </ThemeProvider>
        </DirectionProvider>
      </QueryClientProvider>
    ),
  })

  return createRouter({
    routeTree: rootRoute.addChildren([companiesRoute]),
    history: createMemoryHistory({ initialEntries: ['/catalog/companies'] }),
  })
}

describe('CatalogCompaniesPage 公司目录页面', () => {
  it('不显示仅属于技术目录首页的数据覆盖说明', async () => {
    vi.mocked(catalogApi.companies).mockResolvedValue(response)
    const screen = await render(
      <RouterProvider router={createCompaniesRouter()} />
    )

    await expect
      .element(screen.getByRole('heading', { name: '公司目录' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('数据覆盖说明'))
      .not.toBeInTheDocument()
  })
})
