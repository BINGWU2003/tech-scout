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

  it('显示当前版本、领域中英文名称并链接到对应表格', async () => {
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
    await expect
      .element(screen.getByText('数据版本 2026-09-v6 · 数据截至 2025 年'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: '浏览全部公司' }))
      .toHaveAttribute('href', '/catalog/companies')
    await expect
      .element(
        screen.getByRole('link', {
          name: 'AI 芯片与边缘推理（AI chips and edge inference） 公司',
        })
      )
      .toHaveAttribute(
        'href',
        '/catalog/domains/ai_chips_edge_inference/companies'
      )
    await expect
      .element(screen.getByText('AI 芯片与边缘推理'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('（AI chips and edge inference）'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('工业视觉与 AI 质量检测'))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText('（Industrial vision and AI quality inspection）')
      )
      .toBeInTheDocument()
  })

  it('未配置中文名称时回退显示接口名称', async () => {
    domains.mockResolvedValue({
      ...response,
      items: [
        {
          ...response.items[0],
          domainId: 'quantum_sensing',
          name: 'Quantum sensing',
        },
      ],
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <CatalogOverviewContent />
      </QueryClientProvider>
    )

    await expect
      .element(screen.getByRole('link', { name: 'Quantum sensing 公司' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Quantum sensing'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('（Quantum sensing）'))
      .not.toBeInTheDocument()
  })
})
