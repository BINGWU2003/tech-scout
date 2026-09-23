import { useQuery } from '@tanstack/react-query'
import type {
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
import { ResearchPlanLayout } from './research-plan-layout'

const CompanyRanking = lazy(() => import('./company-ranking'))

export function CompanyWorkspace({
  run,
  events,
  active,
  controls,
  report,
  recordsError,
  retryRecords,
}: {
  run: ResearchSummaryView
  events: ResearchProgressView[]
  active: boolean
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
    .find((event) => event.acquisition?.stage === 'companies')
  const acquisition =
    run.acquisition?.stage === 'companies' &&
    run.sequence >= (latest?.sequence ?? 0)
      ? run.acquisition
      : latest?.acquisition
  const latestProcess = [...events]
    .reverse()
    .find(
      (event) =>
        event.process?.stage === 'companies' && event.process.completed != null
    )
  const completed = run.hasCompanies
    ? (latestProcess?.process?.completed ?? acquisition?.completed)
    : acquisition?.completed
  const total = acquisition?.total

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      {controls}
      <ResearchPlanLayout
        variant='companies'
        footerActions={report}
        autoFollow
        directions={
          <Tabs defaultValue='overview' className='h-full min-h-0 gap-0'>
            <div className='shrink-0 border-b p-3'>
              <TabsList aria-label='切换企业视图' className='w-full'>
                <TabsTrigger value='overview'>概览</TabsTrigger>
                <TabsTrigger value='candidates'>企业查询结果</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value='overview'
              className='min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4'
            >
              <dl className='grid grid-cols-2 gap-3'>
                {[
                  ['查询权利人', run.queriedAssigneeCount],
                  ['发现企业', run.discoveredCompanyCount],
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
            </TabsContent>
            <TabsContent
              value='candidates'
              className='min-h-0 overflow-y-auto overscroll-contain p-4'
            >
              {run.hasCompanies ? (
                <CompanyMatches runId={run.id} />
              ) : (
                <EmptyCompanyState active={active} />
              )}
            </TabsContent>
          </Tabs>
        }
        conversation={
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
                  <Check className='size-4 text-primary' aria-hidden='true' />
                ) : active ? (
                  <LoaderCircle
                    className='size-4 text-primary motion-safe:animate-spin'
                    aria-hidden='true'
                  />
                ) : null}
                {run.hasResult
                  ? '企业查询完成'
                  : run.hasCompanies
                    ? '企业查询完成，正在生成研究报告'
                    : active
                      ? '正在发现相关企业'
                      : '企业发现进度'}
              </div>
              <p className='text-sm tabular-nums'>
                {completed != null
                  ? `已查询 ${completed}${total != null ? ` / ${total}` : ''} 个主体`
                  : run.hasCompanies
                    ? '可查看本次企业查询结果及其来源。'
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
        }
      />
    </div>
  )
}

function EmptyCompanyState({ active }: { active: boolean }) {
  return (
    <p className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
      {active
        ? '正在查询企业信息，完成后会显示结果。'
        : '请先在专利检索页点击“开始企业查询”。'}
    </p>
  )
}
