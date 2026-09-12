import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import PatentCharts from './patent-charts'
import '@/styles/index.css'

const stats = {
  total: 80,
  years: [
    { year: 2022, dateKind: 'publication' as const, count: 12 },
    { year: 2023, dateKind: 'publication' as const, count: 24 },
    { year: 2024, dateKind: 'publication' as const, count: 30 },
    { year: 2024, dateKind: 'grant' as const, count: 8 },
  ],
  unknownYearCount: 6,
  classifications: [
    'H01M',
    'C01B',
    'C08G',
    'H01B',
    'C08L',
    'B01J',
    'G01N',
    'C04B',
    'C22C',
    'B82Y',
  ].map((code, index) => ({ code, count: 50 - index * 4 })),
  unclassifiedCount: 3,
}

it('年份公开和授权分色统计，悬停显示准确数量，分类前八项可展开和收起', async () => {
  await page.viewport(1280, 1000)
  const screen = await render(
    <div className='mx-auto max-w-xl p-4'>
      <PatentCharts stats={stats} />
    </div>
  )
  await expect
    .element(screen.getByText('授权年份（公开年份缺失）', { exact: true }))
    .toBeVisible()
  const yearRegion = screen.getByRole('region', {
    name: '年份分布',
    exact: true,
  })
  await expect
    .poll(
      () =>
        yearRegion.element().querySelectorAll('.recharts-bar-rectangle path')
          .length
    )
    .toBeGreaterThan(0)
  const bar = yearRegion
    .element()
    .querySelector('.recharts-bar-rectangle path')!
  const rect = bar.getBoundingClientRect()
  bar.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    })
  )
  await expect
    .element(screen.getByText('2022 年', { exact: true }))
    .toBeVisible()
  await expect
    .element(
      yearRegion
        .element()
        .querySelector('.recharts-tooltip-item-value') as HTMLElement
    )
    .toHaveTextContent('12 篇')
  await screen.getByText('查看年份数据', { exact: true }).click()
  await expect
    .element(screen.getByRole('row', { name: '2024 30 篇 8 篇' }))
    .toBeVisible()
  const categoryRegion = screen.getByRole('region', {
    name: '技术分类分布',
    exact: true,
  })
  expect(
    categoryRegion.element().querySelectorAll('.recharts-bar-rectangle')
  ).toHaveLength(8)
  await screen.getByRole('button', { name: '查看全部 10 个分类' }).click()
  await expect
    .poll(
      () =>
        categoryRegion.element().querySelectorAll('.recharts-bar-rectangle')
          .length
    )
    .toBe(10)
  await screen.getByRole('button', { name: '收起为前 8 项' }).click()
  await expect
    .poll(
      () =>
        categoryRegion.element().querySelectorAll('.recharts-bar-rectangle')
          .length
    )
    .toBe(8)
  await screen.getByText('查看年份数据', { exact: true }).click()
  await page.screenshot({ path: '__screenshots__/patent-charts-desktop.png' })
  await page.viewport(390, 844)
  await expect
    .element(screen.getByText('点按图表查看数量。仅展示有记录的年份。'))
    .toBeVisible()
  const mobileBar = yearRegion
    .element()
    .querySelector('.recharts-bar-rectangle path')!
  const mobileRect = mobileBar.getBoundingClientRect()
  mobileBar.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      clientX: mobileRect.x + mobileRect.width / 2,
      clientY: mobileRect.y + mobileRect.height / 2,
    })
  )
  await expect
    .element(screen.getByText('2022 年', { exact: true }))
    .toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '__screenshots__/patent-charts-mobile.png' })
  await page.viewport(1280, 1000)
  await screen.rerender(
    <div className='dark mx-auto max-w-xl bg-background p-4 text-foreground'>
      <PatentCharts stats={stats} />
    </div>
  )
  await expect
    .element(screen.getByRole('heading', { name: '年份分布' }))
    .toBeVisible()
  await page.screenshot({ path: '__screenshots__/patent-charts-dark.png' })
  await screen.unmount()
  await page.viewport(1280, 900)
})

it('缺失年份与分类不生成虚假的零值图表', async () => {
  const screen = await render(
    <PatentCharts
      stats={{
        total: 2,
        years: [],
        unknownYearCount: 2,
        classifications: [],
        unclassifiedCount: 2,
      }}
    />
  )
  await expect.element(screen.getByText('暂无可统计的年份数据')).toBeVisible()
  await expect.element(screen.getByText('暂无可统计的技术分类')).toBeVisible()
  expect(screen.container.querySelectorAll('.recharts-wrapper')).toHaveLength(0)
  await screen.unmount()
})
