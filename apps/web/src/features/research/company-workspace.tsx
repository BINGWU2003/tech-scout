import { useQuery } from '@tanstack/react-query'
import type {
  ResearchAction,
  ResearchProgressView,
  ResearchSummaryView,
} from '@tech-scout/contracts'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ContentSkeleton } from '@/components/loading'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { CompanyMatches } from './company-matches'
import { companyRecords } from './company-review-data'
import { EntityReview } from './entity-review'
import { ResearchPlanLayout } from './research-plan-layout'
import { ResearchTimeline } from './research-timeline'
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
  const [tab, setTab] = useState<'matched' | 'review'>(
    run.status === 'awaiting_entities' ? 'review' : 'matched'
  )
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
            footerActions={report}
            detailKey={selected}
            autoFollow={!selected}
            directions={
              <div className='h-full space-y-5 overflow-y-auto overscroll-contain p-4'>
                <dl className='grid grid-cols-2 gap-3'>
                  {[
                    ['已匹配企业', stats.data?.total ?? '—'],
                    ['待核验主体', run.pendingCandidateIds.length],
                    ['已暂存决定', saved],
                    ['尚待处理', remaining],
                  ].map(([label, value]) => (
                    <div key={label} className='rounded-lg bg-muted/40 p-3'>
                      <dt className='text-xs text-muted-foreground'>{label}</dt>
                      <dd className='mt-2 text-2xl font-semibold tabular-nums'>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {stats.isError && (
                  <p role='alert'>
                    企业统计加载失败。
                    <Button variant='link' onClick={() => void stats.refetch()}>
                      重试统计
                    </Button>
                  </p>
                )}
                {run.hasCompanies && stats.isPending && (
                  <ContentSkeleton variant='chart' label='正在汇总企业统计…' />
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
                {run.hasCompanies ? (
                  <>
                    <div className='flex gap-2' aria-label='切换企业列表'>
                      <Button
                        size='sm'
                        variant={tab === 'matched' ? 'default' : 'outline'}
                        aria-pressed={tab === 'matched'}
                        onClick={() => setTab('matched')}
                      >
                        已匹配企业
                      </Button>
                      <Button
                        size='sm'
                        variant={tab === 'review' ? 'default' : 'outline'}
                        aria-pressed={tab === 'review'}
                        onClick={() => setTab('review')}
                      >
                        {run.status === 'awaiting_entities'
                          ? '待核验主体'
                          : '核验记录'}
                      </Button>
                    </div>
                    <div hidden={tab !== 'matched'}>
                      <CompanyMatches runId={run.id} />
                    </div>
                    <div hidden={tab !== 'review'}>{list}</div>
                  </>
                ) : (
                  <p className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
                    {active
                      ? '正在查询企业信息，完成后会显示匹配结果与待核验主体。'
                      : '请先在专利检索页点击“开始企业查询”。'}
                  </p>
                )}
              </div>
            }
            conversation={
              detail ?? (
                <>
                  <section
                    aria-label='企业信息采集进度'
                    className='space-y-2 rounded-lg border bg-muted/20 p-4'
                  >
                    <h3 className='text-sm font-semibold'>
                      {run.hasCompanies
                        ? '企业信息采集完成'
                        : active
                          ? '正在发现相关企业'
                          : '企业发现进度'}
                    </h3>
                    <p className='text-sm'>
                      {completed != null
                        ? `已查询 ${completed}${total != null ? ` / ${total}` : ''} 个主体`
                        : run.hasCompanies
                          ? '可查看已匹配企业，并核验需要确认的主体。'
                          : '查询开始后，进度将在这里持续更新。'}
                    </p>
                    {completed != null && total != null && total > 0 && (
                      <progress
                        aria-label='企业采集完成进度'
                        className='w-full accent-primary'
                        value={completed}
                        max={total}
                      />
                    )}
                  </section>
                  {recordsError && (
                    <p role='alert'>
                      发现记录加载失败。
                      <Button variant='link' onClick={retryRecords}>
                        重试记录
                      </Button>
                    </p>
                  )}
                  <ResearchTimeline
                    title='企业发现记录'
                    initiallyOpen
                    events={companyRecords(events)}
                    active={active}
                  />
                </>
              )
            }
            composer={run.hasCompanies ? footer : null}
          />
        </div>
      )}
    />
  )
}
