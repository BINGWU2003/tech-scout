import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { researchApi } from '@/lib/research-api'
import { PatentList } from './snapshot-details'
import '@/styles/index.css'

const patents = Array.from({ length: 21 }, (_, index) => ({
  id: `CN${index + 1}`,
  title: `储能装置及其控制方法 ${index + 1}`,
  year: 2025,
  dateKind: 'publication' as const,
  abstract: '用于储能系统的控制方法，提升充放电效率。'.repeat(20),
  claims: index === 20 ? null : '权利要求正文。'.repeat(200),
  description: '说明书正文。'.repeat(200),
  parties: [{ name: '示例科技有限公司', roles: ['original_assignee'] }],
  cpcs: ['H02J 7/00'],
  domains: ['储能'],
  source: { url: 'https://patents.google.com/patent/CN1', sha256: null },
}))
function setup(nested = false) {
  const list = vi
    .spyOn(researchApi, 'patents')
    .mockImplementation(async (_run, number) => ({
      items: patents.slice((number - 1) * 20, number * 20),
      total: 21,
      page: number,
      pageSize: 20,
    }))
  const detail = vi
    .spyOn(researchApi, 'patent')
    .mockImplementation(async (_run, id) => ({
      items: patents.filter((p) => p.id === id),
      total: 1,
      page: 1,
      pageSize: 20,
    }))
  function Nested() {
    const [open, setOpen] = useState(true)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>企业快照</SheetTitle>
          <PatentList runId='run' companyId='company' />
        </SheetContent>
      </Sheet>
    )
  }
  const screen = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {nested ? (
        <Nested />
      ) : (
        <div
          data-testid='patent-panel'
          style={{ height: 600, overflowY: 'auto' }}
        >
          <div style={{ height: 200 }}>专利统计</div>
          <PatentList runId='run' citations={['CN20']} />
          <div style={{ height: 600 }}>其他研究内容</div>
        </div>
      )}
    </QueryClientProvider>
  )
  return { screen, list, detail }
}
afterEach(() => vi.restoreAllMocks())

it('慢速切换专利时保留旧详情并遮罩，关闭入口仍可操作', async () => {
  await page.viewport(390, 844)
  const { detail } = setup()
  await page
    .getByRole('button', { name: patents[0].title, exact: true })
    .click()
  await expect
    .element(page.getByRole('heading', { name: patents[0].title }))
    .toBeVisible()
  const original = page.getByRole('tabpanel').element()
  const height = (page.getByRole('dialog').element() as HTMLElement)
    .offsetHeight
  let finish!: (value: Awaited<ReturnType<typeof researchApi.patent>>) => void
  detail.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect.element(page.getByText('正在切换专利…')).toBeVisible()
  expect(original.closest('[inert]')).not.toBeNull()
  expect(page.getByRole('dialog').element().textContent).toContain(
    patents[0].abstract
  )
  expect((page.getByRole('dialog').element() as HTMLElement).offsetHeight).toBe(
    height
  )
  await expect
    .element(page.getByRole('button', { name: 'Close', exact: true }))
    .toBeEnabled()
  await page.screenshot({
    path: '__screenshots__/patent-loading-overlay-mobile.png',
  })
  finish({ items: [patents[1]], total: 1, page: 1, pageSize: 20 })
  await expect
    .element(page.getByRole('heading', { name: patents[1].title }))
    .toBeVisible()
  await expect.element(page.getByText('正在切换专利…')).not.toBeInTheDocument()
  await page.getByRole('button', { name: '关闭详情' }).click()
})

it('触底追加下一页，加载和失败保留位置，重试后展示结束状态', async () => {
  await page.viewport(1280, 900)
  const { list } = setup()
  await expect
    .element(page.getByRole('button', { name: patents[0].title, exact: true }))
    .toBeVisible()
  const panel = page.getByTestId('patent-panel').element()
  const first = panel.querySelector('li')
  expect(panel.querySelectorAll('li')).toHaveLength(20)
  expect(list).toHaveBeenCalledTimes(1)
  let reject!: (reason: Error) => void
  list.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  const ul = panel.querySelector('ul')!
  panel.scrollTop = ul.offsetTop + ul.clientHeight - panel.clientHeight + 80
  await expect.element(page.getByText('正在加载更多专利…')).toBeVisible()
  const scrollTop = panel.scrollTop
  expect(panel.querySelectorAll('li')).toHaveLength(20)
  reject(new Error('offline'))
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('已保留现有专利')
  expect(panel.scrollTop).toBe(scrollTop)
  expect(panel.querySelectorAll('li')).toHaveLength(20)
  expect(list).toHaveBeenCalledTimes(2)
  await page.getByRole('button', { name: '重试加载' }).click()
  await expect.poll(() => panel.querySelectorAll('li').length).toBe(21)
  expect(panel.querySelector('li')).toBe(first)
  expect(panel.scrollTop).toBe(scrollTop)
  expect(list).toHaveBeenCalledTimes(3)
  panel.scrollTop += 500
  await expect.element(page.getByText('已全部加载')).toBeVisible()
  await expect.element(page.getByText('已加载 21 / 21 篇')).toBeVisible()
  await page
    .getByRole('button', { name: patents[20].title, exact: true })
    .click()
  await expect
    .element(page.getByRole('heading', { name: patents[20].title }))
    .toBeVisible()
  await expect.element(page.getByText('21 / 21', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭详情' }).click()
  expect(list).toHaveBeenCalledTimes(3)
})

it('直接打开详情、长文滚动、跨页阅读后返回原列表与焦点', async () => {
  await page.viewport(1280, 900)
  const { list } = setup()
  const trigger = page.getByRole('button', {
    name: patents[19].title,
    exact: true,
  })
  await trigger.click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  await expect
    .element(page.getByRole('heading', { name: patents[19].title }))
    .toBeVisible()
  await page.getByRole('tab', { name: '权利要求' }).click()
  const panel = page.getByRole('tabpanel').element()
  expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight)
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect
    .element(page.getByRole('heading', { name: patents[20].title }))
    .toBeVisible()
  await expect
    .element(page.getByRole('tab', { name: '概览' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(page.getByRole('button', { name: '下一篇', exact: true }))
    .toBeDisabled()
  expect(list).toHaveBeenCalledWith('run', 2, undefined)
  await page.getByRole('tab', { name: '权利要求' }).click()
  await expect.element(page.getByText('该快照未提供权利要求')).toBeVisible()
  await page.getByRole('button', { name: '上一篇', exact: true }).click()
  await expect
    .element(page.getByRole('heading', { name: patents[19].title }))
    .toBeVisible()
  await page.getByRole('button', { name: '关闭详情' }).click()
  await expect.element(trigger).toHaveFocus()
  expect(
    page
      .getByRole('list', { name: '本次专利列表' })
      .element()
      .querySelectorAll('li').length
  ).toBeGreaterThanOrEqual(20)
})

it('手机企业抽屉内打开弹窗，Escape 只关闭专利并回到企业', async () => {
  await page.viewport(390, 844)
  setup(true)
  const trigger = page.getByRole('button', {
    name: patents[0].title,
    exact: true,
  })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: patents[0].title })
  await expect.element(dialog).toBeVisible()
  const bounds = dialog.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(390)
  expect(bounds.bottom).toBeLessThanOrEqual(844)
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('heading', { name: '企业快照' }))
    .toBeVisible()
  await expect.element(trigger).toHaveFocus()
})

it('详情请求失败可重试，跨页失败保留当前专利', async () => {
  await page.viewport(1280, 900)
  const { detail, list } = setup()
  detail.mockRejectedValueOnce(new Error('offline'))
  await page
    .getByRole('button', { name: patents[19].title, exact: true })
    .click()
  await expect
    .element(page.getByText('专利详情加载失败，请重试。'))
    .toBeVisible()
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect
    .element(page.getByRole('heading', { name: patents[19].title }))
    .toBeVisible()
  list.mockRejectedValueOnce(new Error('offline'))
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect
    .element(page.getByText('切换失败，请再次点击重试。'))
    .toBeVisible()
  await expect
    .element(page.getByRole('heading', { name: patents[19].title }))
    .toBeVisible()
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect
    .element(page.getByRole('heading', { name: patents[20].title }))
    .toBeVisible()
})
