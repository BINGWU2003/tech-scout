import { useQuery } from '@tanstack/react-query'
import type {
  ResearchAction,
  ResearchProgressView,
  ResearchSummaryView,
} from '@tech-scout/contracts'
import { Check, LoaderCircle } from 'lucide-react'
import { lazy, Suspense, type ReactNode } from 'react'
import { ContentSkeleton } from '@/components/loading'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { researchApi } from '@/lib/research-api'
import { CompanyDiscoveryRecords } from './company-discovery-records'
import { CompanyMatches } from './company-matches'
import { EntityReview } from './entity-review'
import { ResearchPlanLayout } from './research-plan-layout'
const CompanyRanking = lazy(() => import('./company-ranking'))

export function CompanyWorkspace({
  run,
  events,
  active,
  readOnly,
  busy,
  onSubmit,
  controls,
  report,
  recordsError,
  retryRecords,
}: {
  run: ResearchSummaryView
  events: ResearchProgressView[]
  active: boolean
  readOnly: boolean
  busy: boolean
  onSubmit: (action: ResearchAction) => Promise<void>
  controls: ReactNode
  report: ReactNode
  recordsError: boolean
  retryRecords: () => void
}) {
  const stats = useQuery({
    queryKey: ['research', run.id, 'company-stats'],
    queryFn: () => researchApi.companyStats(run.id),
    enabled: run.hasCompanies,
  })
  const latest = [...events]
    .reverse()
    .find((e) => e.acquisition?.stage === 'companies')
  const acquisition =
    run.acquisition?.stage === 'companies' &&
    run.sequence >= (latest?.sequence ?? 0)
      ? run.acquisition
      : latest?.acquisition
  const latestProcess = [...events]
    .reverse()
    .find(
      (e) => e.process?.stage === 'companies' && e.process.completed != null
    )
  const completed = run.hasCompanies
    ? (latestProcess?.process?.completed ??
      acquisition?.completed ??
      latest?.acquisition?.completed)
    : (acquisition?.completed ?? latest?.acquisition?.completed)
  const total = acquisition?.total ?? latest?.acquisition?.total
  return (
    <EntityReview
      onSubmit={onSubmit}
      run={run}
      busy={busy}
      readOnly={readOnly}
      renderWorkspace={({
        list,
        detail,
        footer,
        selected,
        saved,
        remaining,
      }) => (
        <div className='flex min-h-0 flex-1 flex-col gap-3'>
          {controls}
          <ResearchPlanLayout
            variant='companies'
            footerActions={
              <>
                {run.hasCompanies && footer}
                {report}
              </>
            }
            detailKey={selected}
            autoFollow={!selected}
            directions={
              <Tabs
                defaultValue={
                  run.status === 'awaiting_entities' ? 'review' : 'overview'
                }
                className='h-full min-h-0 gap-0'
              >
                <div className='shrink-0 border-b p-3'>
                  <TabsList aria-label='切换企业视图' className='w-full'>
                    <TabsTrigger value='overview'>概览</TabsTrigger>
                    <TabsTrigger value='matched'>已匹配企业</TabsTrigger>
                    <TabsTrigger value='review'>
                      {run.status === 'awaiting_entities'
                        ? '待核验主体'
                        : '核验记录'}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent
                  value='overview'
                  forceMount
                  className='min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4 data-[state=inactive]:hidden'
                >
                  <dl className='grid grid-cols-2 gap-3'>
                    {[
                      ['已匹配企业', stats.data?.total ?? '—'],
                      ['待核验主体', run.pendingCandidateIds.length],
                      ['已暂存决定', saved],
                      ['尚待处理', remaining],
                    ].map(([label, value]) => (
                      <div key={label} className='rounded-lg bg-muted/40 p-3'>
                        <dt className='text-xs text-muted-foreground'>
                          {label}
                        </dt>
                        <dd className='mt-2 text-2xl font-semibold tabular-nums'>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {stats.isError && (
                    <p role='alert'>
                      企业统计加载失败。
                      <Button
                        variant='link'
                        onClick={() => void stats.refetch()}
                      >
                        重试统计
                      </Button>
                    </p>
                  )}
                  {run.hasCompanies && stats.isPending && (
                    <ContentSkeleton
                      variant='chart'
                      label='正在汇总企业统计…'
                    />
                  )}
                  {stats.data && (
                    <Suspense
                      fallback={
                        <ContentSkeleton
                          variant='chart'
                          label='正在加载企业排行…'
                        />
                      }
                    >
                      <CompanyRanking items={stats.data.ranking} />
                    </Suspense>
                  )}
                </TabsContent>
                <TabsContent
                  value='matched'
                  forceMount
                  className='min-h-0 overflow-y-auto overscroll-contain p-4 data-[state=inactive]:hidden'
                >
                  {run.hasCompanies ? (
                    <CompanyMatches runId={run.id} />
                  ) : (
                    <p className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
                      {active
                        ? '正在查询企业信息，完成后会显示匹配结果。'
                        : '请先在专利检索页点击“开始企业查询”。'}
                    </p>
                  )}
                </TabsContent>
                <TabsContent
                  value='review'
                  forceMount
                  className='min-h-0 overflow-y-auto overscroll-contain p-4 data-[state=inactive]:hidden'
                >
                  {run.hasCompanies ? (
                    list
                  ) : (
                    <p className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
                      {active
                        ? '正在查询企业信息，完成后会显示待核验主体。'
                        : '请先在专利检索页点击“开始企业查询”。'}
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            }
            conversation={
              detail ?? (
                <>
                  {recordsError && (
                    <p role='alert'>
                      发现记录加载失败。
                      <Button variant='link' onClick={retryRecords}>
                        重试记录
                      </Button>
                    </p>
                  )}
                  <CompanyDiscoveryRecords events={events} active={active} />
                  <section
                    aria-label='企业信息采集进度'
                    className='space-y-3 rounded-lg border bg-muted/20 p-4'
                  >
                    <div className='flex items-center gap-2 text-sm font-medium'>
                      {run.hasCompanies ? (
                        <Check
                          className='size-4 text-primary'
                          aria-hidden='true'
                        />
                      ) : active ? (
                        <LoaderCircle
                          className='size-4 text-primary motion-safe:animate-spin'
                          aria-hidden='true'
                        />
                      ) : null}
                      {run.hasCompanies
                        ? '企业信息采集完成'
                        : active
                          ? '正在发现相关企业'
                          : '企业发现进度'}
                    </div>
                    <p className='text-sm tabular-nums'>
                      {completed != null
                        ? `已查询 ${completed}${total != null ? ` / ${total}` : ''} 个主体`
                        : run.hasCompanies
                          ? '可查看已匹配企业，并核验需要确认的主体。'
                          : '查询开始后，进度将在这里持续更新。'}
                    </p>
                    {completed != null && total != null && total > 0 && (
                      <progress
                        aria-label='企业采集完成进度'
                        className='block h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary'
                        value={Math.min(completed, total)}
                        max={total}
                      />
                    )}
                  </section>
                </>
              )
            }
          />
        </div>
      )}
    />
  )
}
