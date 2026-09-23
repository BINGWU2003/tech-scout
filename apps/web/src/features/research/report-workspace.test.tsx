import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { researchResultViewSchema } from '@tech-scout/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { researchApi } from '@/lib/research-api'
import { ReportWorkspace } from './report-workspace'
import '@/styles/index.css'

afterEach(() => vi.restoreAllMocks())

it('无企业命中时仍展示全部专利评估，并可逐页展开', async () => {
  const patents = Array.from({ length: 21 }, (_, index) => ({
    id: `CN${index + 1}`,
    priority: 'high' as const,
    reason: `专利 ${index + 1} 的摘要与研究问题相关`,
  }))
  vi.spyOn(researchApi, 'result').mockResolvedValue(
    researchResultViewSchema.parse({
      releaseId: 'release-v3',
      patentCount: patents.length,
      patents,
      companies: [],
      missing: ['专利权属核验'],
      emptyReason: null,
    })
  )
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <div className='h-[800px]'>
        <ReportWorkspace runId='run' controls={null} records={null} />
      </div>
    </QueryClientProvider>
  )
  await expect.element(screen.getByText('本次没有企业查询结果')).toBeVisible()
  await expect.element(screen.getByText('CN1 · 优先')).toBeVisible()
  expect(screen.getByText('CN21 · 优先').all()).toHaveLength(0)
  await screen.getByRole('button', { name: '加载更多专利' }).click()
  await expect.element(screen.getByText('CN21 · 优先')).toBeVisible()
  await screen.unmount()
})
