import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { CatalogOverviewContent } from './catalog-overview'

const domains = vi.hoisted(() => vi.fn())
vi.mock('@/lib/catalog-api', () => ({ catalogApi: { domains } }))

const response = {
  release: {
    releaseId: '2026-09-v6',
    dataset: 'ai-domains',
    generatedAt: '2026-09-03T00:00:00.000Z',
    publishedAt: '2026-09-03T01:00:00.000Z',
    periodFromYear: 2019,
    periodToYear: 2025,
    unavailableFields: ['abstract'],
  },
  items: [
    {
      domainId: 'ai_chips_edge_inference',
      name: 'AI chips and edge inference',
      ruleVersion: 'rules-v1',
      definition: {},
      patentCount: 1882,
      companyCount: 150,
    },
    {
      domainId: 'industrial_vision_quality_inspection',
      name: 'Industrial vision and AI quality inspection',
      ruleVersion: 'rules-v1',
      definition: {},
      patentCount: 981,
      companyCount: 109,
    },
  ],
}

describe('CatalogOverview 目录概览', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    domains.mockResolvedValue(response)
  })

  it('显示当前版本并将每个领域链接到对应表格', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <CatalogOverviewContent />
      </QueryClientProvider>
    )

    await expect
      .element(screen.getByRole('heading', { name: '技术目录' }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('2026-09-v6')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: /AI chips/ }))
      .toHaveAttribute(
        'href',
        '/catalog/domains/ai_chips_edge_inference/companies'
      )
    await expect
      .element(screen.getByRole('link', { name: /Industrial vision/ }))
      .toBeInTheDocument()
  })
})
