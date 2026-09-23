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
import { useIsMobile } from '@/hooks/use-mobile'
import type { researchApi } from '@/lib/research-api'
export default function CompanyRanking({
  items,
}: {
  items: Awaited<ReturnType<typeof researchApi.companyStats>>['ranking']
}) {
  const mobile = useIsMobile()
  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <h3 className='text-sm font-semibold'>企业关联专利线索数量 · 前 8 项</h3>
      {items.length ? (
        <div style={{ height: Math.max(150, items.length * 42 + 32) }}>
          <ResponsiveContainer
            width='100%'
            height={Math.max(150, items.length * 42 + 32)}
            initialDimension={{ width: 320, height: 250 }}
            minWidth={0}
          >
            <BarChart
              data={items}
              layout='vertical'
              accessibilityLayer
              margin={{ left: 0, right: 30 }}
            >
              <CartesianGrid
                horizontal={false}
                stroke='var(--border)'
                strokeDasharray='3 3'
              />
              <XAxis
                type='number'
                allowDecimals={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type='category'
                dataKey='name'
                width={100}
                tickFormatter={(name: string) =>
                  name.length > 7 ? name.slice(0, 7) + '…' : name
                }
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <Tooltip
                trigger={mobile ? 'click' : 'hover'}
                formatter={(value) => [`${value} 条`, '专利线索']}
                contentStyle={{
                  background: 'var(--popover)',
                  color: 'var(--popover-foreground)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                itemStyle={{ color: 'var(--popover-foreground)' }}
              />
              <Bar
                dataKey='patentCount'
                fill='var(--chart-2)'
                maxBarSize={20}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey='patentCount'
                  position='right'
                  fontSize={11}
                  fill='var(--foreground)'
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>暂无企业查询结果。</p>
      )}
      <p className='text-xs text-muted-foreground'>
        基于全部企业查询结果；同一专利可作为多家企业的调研线索，数量不代表专利权属。
      </p>
    </section>
  )
}
