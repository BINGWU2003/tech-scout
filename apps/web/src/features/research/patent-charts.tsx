import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import type { researchApi } from '@/lib/research-api'

type Stats = Awaited<ReturnType<typeof researchApi.patentStats>>
const tick = { fill: 'var(--muted-foreground)', fontSize: 11 }
const tooltipStyle = {
  background: 'var(--popover)',
  color: 'var(--popover-foreground)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
}

export default function PatentCharts({ stats }: { stats: Stats }) {
  const mobile = useIsMobile()
  const [expanded, setExpanded] = useState(false)
  const years = [...stats.years].sort((a, b) => a.year - b.year)
  const classifications = [...stats.classifications].sort(
    (a, b) => b.count - a.count || a.code.localeCompare(b.code)
  )
  const visible = expanded ? classifications : classifications.slice(0, 8)
  const trigger = mobile ? 'click' : 'hover'
  const hint = mobile ? '点按图表查看数量' : '悬停或使用方向键查看数量'
  return (
    <div className='space-y-4'>
      <section aria-label='年份分布' className='min-w-0 rounded-lg border p-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-semibold'>年份分布</h3>
          <span className='text-xs text-muted-foreground'>单位：篇</span>
        </div>
        {years.length ? (
          <>
            <div className='mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground'>
              <span className='flex items-center gap-1.5'>
                <span
                  className='size-2.5 rounded-sm bg-chart-2'
                  aria-hidden='true'
                />
                公开年份
              </span>
            </div>
            <div className='mt-3 h-56 min-w-0' aria-label='专利年份柱状图'>
              <ResponsiveContainer
                width='100%'
                height='100%'
                minWidth={0}
                initialDimension={{ width: 320, height: 224 }}
              >
                <BarChart
                  data={years}
                  accessibilityLayer
                  margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke='var(--border)'
                    strokeDasharray='3 3'
                  />
                  <XAxis
                    dataKey='year'
                    tick={tick}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={tick}
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    trigger={trigger}
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: 'var(--popover-foreground)' }}
                    labelFormatter={(label) => `${label} 年`}
                    formatter={(value, name) => [`${value} 篇`, name]}
                    cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey='count'
                    name='公开年份'
                    fill='var(--chart-2)'
                    maxBarSize={40}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>
              {hint}。仅展示有记录的年份。
            </p>
            <details className='mt-3 text-xs'>
              <summary className='cursor-pointer text-muted-foreground'>
                查看年份数据
              </summary>
              <table className='mt-2 w-full text-left'>
                <caption className='sr-only'>年份统计明细</caption>
                <thead>
                  <tr>
                    <th scope='col'>年份</th>
                    <th scope='col'>公开</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr key={year.year}>
                      <th scope='row' className='py-1 font-normal'>
                        {year.year}
                      </th>
                      <td>{year.count} 篇</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            暂无可统计的年份数据
          </p>
        )}
        <p className='mt-3 text-xs leading-5 text-muted-foreground'>
          按公开年份统计；{stats.unknownYearCount} 篇年份未知。
        </p>
      </section>
      <section
        aria-label='技术分类分布'
        className='min-w-0 rounded-lg border p-4'
      >
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-semibold'>技术分类分布</h3>
          <span className='text-xs text-muted-foreground'>
            {expanded
              ? `全部 ${classifications.length} 项`
              : `前 ${Math.min(8, classifications.length)} 项`}{' '}
            · 单位：篇
          </span>
        </div>
        {visible.length ? (
          <>
            <div
              className='mt-3 max-h-[360px] overflow-y-auto overscroll-contain'
              aria-label='专利技术分类条形图'
            >
              <div style={{ height: Math.max(144, visible.length * 36 + 36) }}>
                <ResponsiveContainer
                  width='100%'
                  height='100%'
                  minWidth={0}
                  initialDimension={{
                    width: 320,
                    height: Math.max(144, visible.length * 36 + 36),
                  }}
                >
                  <BarChart
                    data={visible}
                    layout='vertical'
                    accessibilityLayer
                    margin={{ top: 0, right: 36, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      stroke='var(--border)'
                      strokeDasharray='3 3'
                    />
                    <XAxis
                      type='number'
                      tick={tick}
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type='category'
                      dataKey='code'
                      width={48}
                      tick={tick}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <Tooltip
                      trigger={trigger}
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: 'var(--popover-foreground)' }}
                      formatter={(value) => [`${value} 篇`, '相关专利']}
                      cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey='count'
                      name='相关专利'
                      fill='var(--chart-2)'
                      radius={[0, 4, 4, 0]}
                      maxBarSize={20}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey='count'
                        position='right'
                        fill='var(--foreground)'
                        fontSize={11}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {classifications.length > 8 && (
              <Button
                size='sm'
                variant='ghost'
                className='mt-2 w-full'
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? '收起为前 8 项'
                  : `查看全部 ${classifications.length} 个分类`}
              </Button>
            )}
          </>
        ) : (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            暂无可统计的技术分类
          </p>
        )}
        <p className='mt-3 text-xs leading-5 text-muted-foreground'>
          按分类号前四位汇总，一篇专利可属于多个分类；{stats.unclassifiedCount}{' '}
          篇未提供分类。
        </p>
      </section>
    </div>
  )
}
