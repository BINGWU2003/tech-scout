import { useQuery } from '@tanstack/react-query'
import type {
  ResearchProgressView,
  ResearchSummaryView,
} from '@tech-scout/contracts'
import { Check, LoaderCircle, Search } from 'lucide-react'
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { patentSearchData } from './patent-search-data'
import { ResearchPlanLayout } from './research-plan-layout'
import { PatentList } from './snapshot-details'

function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: ReactNode
  note: string
}) {
  return (
    <div className='min-w-0 rounded-lg bg-muted/40 p-3'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='mt-2 text-2xl font-semibold tabular-nums'>{value}</dd>
      <p className='mt-1 text-xs text-muted-foreground'>{note}</p>
    </div>
  )
}

const PatentCharts = lazy(() => import('./patent-charts'))

export function PatentWorkspace({
  run,
  events,
  active,
  eventsError,
  onRetryEvents,
  controls,
  actions,
}: {
  run: ResearchSummaryView
  events: ResearchProgressView[]
  active: boolean
  eventsError: boolean
  onRetryEvents: () => void
  controls: ReactNode
  actions: ReactNode
}) {
  const data = useMemo(() => patentSearchData(run, events), [run, events])
  const stats = useQuery({
    queryKey: ['research', run.id, 'patent-stats'],
    queryFn: () => researchApi.patentStats(run.id),
    enabled: run.hasPatents,
  })
  const total = stats.data?.total ?? data.discovered
  const completed = run.hasPatents
    ? (stats.data?.total ?? data.details?.total ?? data.details?.completed)
    : data.details?.completed
  const detailTotal = stats.data?.total ?? data.details?.total
  const detailDone = run.hasPatents || data.details?.status === 'completed'
  const detailLabel = detailDone
    ? '专利详情获取完成'
    : data.details
      ? active
        ? '正在获取专利详情'
        : '专利详情获取已停止'
      : '等待获取专利详情'
  const detailText =
    completed != null
      ? `${completed}${detailTotal != null ? ` / ${detailTotal}` : ''} 篇`
      : '—'
  const directions = run.confirmedPlan?.directions ?? []
  const searchedDirections = new Set(
    data.groups.map((group) => group.direction)
  ).size
  const searchCount = directions.reduce(
    (sum, direction) => sum + new Set(direction.keywords).size,
    0
  )
  return (
    <ResearchPlanLayout
      variant='patents'
      directions={
        <div className='h-full space-y-5 overflow-y-auto overscroll-contain p-4'>
          <dl className='grid grid-cols-2 gap-3'>
            <Metric
              label='去重专利'
              value={total ?? '—'}
              note={
                run.hasPatents ? '本次检索最终纳入' : '按年份筛选后累计纳入'
              }
            />
            <Metric label='详情已获取' value={detailText} note={detailLabel} />
            <Metric
              label='已检索词组'
              value={`${data.groups.length}${searchCount ? ` / ${searchCount}` : ''}`}
              note={`已完成 ${data.completedPages} 页检索`}
            />
            <Metric
              label='已检索方向'
              value={`${searchedDirections} / ${directions.length}`}
              note={
                run.fromYear && run.toYear
                  ? `${run.fromYear}–${run.toYear} 年`
                  : '按已确认计划检索'
              }
            />
          </dl>
          {!run.hasPatents && (
            <p className='text-xs leading-5 text-muted-foreground'>
              {run.confirmedPlan
                ? '检索与详情获取进度会自动更新，完成后展示年份和技术分类分布。'
                : '请先在技术方向与计划页确认检索计划。'}
            </p>
          )}
          {run.hasPatents && stats.isPending && (
            <p role='status' className='text-sm'>
              正在汇总全部专利…
            </p>
          )}
          {stats.isError && (
            <div role='alert' className='text-sm'>
              统计暂时无法加载。
              <Button
                variant='link'
                size='sm'
                onClick={() => void stats.refetch()}
              >
                重新加载统计
              </Button>
            </div>
          )}
          {stats.data && (
            <Suspense
              fallback={
                <p role='status' className='text-sm'>
                  正在加载统计图表…
                </p>
              }
            >
              <PatentCharts stats={stats.data} />
            </Suspense>
          )}
          {actions}
          {run.hasPatents && (
            <section className='space-y-3'>
              <h3 className='text-sm font-semibold'>本次专利</h3>
              <PatentList runId={run.id} />
            </section>
          )}
        </div>
      }
      conversation={
        <>
          <p className='text-xs leading-5 text-muted-foreground'>
            按方向与检索词记录搜索结果，同一页的进度合并更新。
          </p>
          {eventsError && (
            <div role='alert' className='text-sm'>
              搜索记录加载失败。
              <Button variant='link' size='sm' onClick={onRetryEvents}>
                重新加载记录
              </Button>
            </div>
          )}
          {data.groups.length === 0 && (
            <p className='rounded-lg border border-dashed p-5 text-sm text-muted-foreground'>
              {active
                ? '正在准备检索条件，搜索开始后将在这里显示记录。'
                : '暂无专利搜索记录。'}
            </p>
          )}
          {data.groups.map((group) => (
            <section
              key={JSON.stringify([group.direction, group.keyword])}
              className='space-y-3 rounded-lg border p-4'
            >
              <div className='flex items-start gap-2'>
                <Search
                  className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                  aria-hidden='true'
                />
                <div className='min-w-0'>
                  <p className='text-xs text-muted-foreground'>
                    {group.direction}
                  </p>
                  <h3 className='mt-1 text-sm font-medium break-words'>
                    {group.keyword}
                  </h3>
                </div>
              </div>
              <ol className='space-y-3'>
                {[...group.pages.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([page, event]) => {
                    const process = event.process!
                    const failed = process.outcome === 'failed'
                    const label =
                      process.outcome === 'completed'
                        ? `返回 ${process.count ?? 0} 条结果`
                        : failed
                          ? '检索失败'
                          : process.outcome === 'stopped' || !active
                            ? '检索已停止'
                            : '正在检索'
                    return (
                      <li
                        key={page}
                        className='space-y-1 border-t pt-3 text-xs [content-visibility:auto]'
                      >
                        <div className='flex flex-wrap justify-between gap-2'>
                          <p className={failed ? 'text-destructive' : ''}>
                            第 {page} 页 · {label}
                          </p>
                          <time
                            className='text-muted-foreground'
                            dateTime={process.occurredAt ?? event.createdAt}
                          >
                            {new Date(
                              process.occurredAt ?? event.createdAt
                            ).toLocaleTimeString('zh-CN')}
                          </time>
                        </div>
                        {process.completed != null && (
                          <p className='text-muted-foreground'>
                            累计纳入 {process.completed} 篇去重专利
                          </p>
                        )}
                        {failed && (
                          <p className='break-words text-destructive'>
                            {process.message}
                          </p>
                        )}
                        {process.url && (
                          <a
                            href={process.url}
                            target='_blank'
                            rel='noreferrer'
                            className='inline-block underline underline-offset-4'
                          >
                            打开检索来源 ↗
                          </a>
                        )}
                      </li>
                    )
                  })}
              </ol>
            </section>
          ))}
          <section
            aria-label='专利详情获取进度'
            className='space-y-3 rounded-lg border bg-muted/20 p-4'
          >
            <div className='flex items-center gap-2 text-sm font-medium'>
              {active && data.details && !detailDone ? (
                <LoaderCircle
                  className='size-4 animate-spin text-primary'
                  aria-hidden='true'
                />
              ) : detailDone ? (
                <Check className='size-4 text-primary' aria-hidden='true' />
              ) : null}
              {detailLabel}
            </div>
            <p className='text-sm tabular-nums'>
              {completed != null
                ? `已获取 ${detailText}专利详情`
                : '搜索完成后开始，进度将在此持续更新。'}
            </p>
            {detailTotal != null && detailTotal > 0 && completed != null && (
              <progress
                className='block h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary'
                aria-label='专利详情完成进度'
                max={detailTotal}
                value={Math.min(completed, detailTotal)}
              />
            )}
          </section>
          {data.notices.length > 0 && (
            <details
              className='rounded-lg border p-4 text-xs'
              open={data.notices.some(
                (event) => event.process?.outcome === 'failed'
              )}
            >
              <summary className='cursor-pointer font-medium'>
                阶段摘要与异常
              </summary>
              <ol className='mt-3 space-y-3'>
                {data.notices.map((event) => (
                  <li
                    key={event.sequence}
                    className={
                      event.process?.outcome === 'failed'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }
                  >
                    {event.process?.message}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      }
      composer={controls}
    />
  )
}
