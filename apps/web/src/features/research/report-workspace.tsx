import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Building2, FileText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ContentSkeleton } from '@/components/loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { countryName } from './labels'
import { ResearchPlanLayout } from './research-plan-layout'
import {
  CompanySnapshotDetails,
  PatentList,
  PatentSnapshot,
} from './snapshot-details'

export function ReportWorkspace({
  runId,
  controls,
  records,
  notice,
  empty,
}: {
  runId?: string
  controls: ReactNode
  records: ReactNode
  notice?: ReactNode
  empty?: ReactNode
}) {
  const query = useQuery({
    queryKey: ['research', runId, 'result'],
    queryFn: () => researchApi.result(runId!),
    enabled: Boolean(runId),
  })
  const [company, setCompany] = useState<string | null>(null)
  const [patent, setPatent] = useState<string | null>(null)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const result = query.data
  const selected =
    result?.companies.find((item) => item.id === company) ??
    result?.companies[0]
  return (
    <ResearchPlanLayout
      variant='report'
      autoFollow={false}
      detailKey={detailKey}
      directions={
        <div className='h-full space-y-5 overflow-y-auto overscroll-contain p-4'>
          {controls}
          {notice}
          {runId && query.isPending && (
            <ContentSkeleton variant='workspace' label='正在读取报告…' />
          )}
          {runId && query.isError && (
            <p role='alert' className='text-sm'>
              报告加载失败。
              <Button
                variant='link'
                size='sm'
                onClick={() => void query.refetch()}
              >
                重新加载
              </Button>
            </p>
          )}
          {!runId && empty}
          {result && (
            <>
              <dl className='grid grid-cols-3 gap-2' aria-label='研究报告统计'>
                {[
                  ['去重专利', result.patentCount],
                  ['候选主体', result.companies.length],
                  ['未解析主体', result.unresolvedSubjects.length],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className='rounded-lg border bg-muted/20 p-3'
                  >
                    <dt className='text-xs text-muted-foreground'>{label}</dt>
                    <dd className='mt-2 text-2xl font-semibold tabular-nums'>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className='space-y-2 rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground'>
                <p>
                  结果保留程序原始排序。模型解释仅为标题 / IPC
                  推断，不证明产品能力；名单可能包含非商业主体或宽泛硬件相关项。
                </p>
                {result.warnings.map((warning) => (
                  <p
                    key={warning}
                    className='text-amber-700 dark:text-amber-300'
                  >
                    {warning}
                  </p>
                ))}
                {result.missing.length > 0 && (
                  <p>数据缺失：{result.missing.join('、')}</p>
                )}
                <p className='break-all'>研究快照：{result.releaseId}</p>
              </div>
              <section className='space-y-3' aria-label='候选企业名单'>
                <div className='flex items-center justify-between gap-2'>
                  <h3 className='text-sm font-semibold'>候选企业</h3>
                  <span className='text-xs text-muted-foreground'>
                    {result.companies.length} 个主体 · 原始排序
                  </span>
                </div>
                {result.companies.length === 0 && (
                  <div
                    role='status'
                    className='space-y-2 rounded-lg border border-dashed p-5 text-sm'
                  >
                    <h3 className='font-medium'>本次没有可输出的匹配名单</h3>
                    <p className='text-muted-foreground'>
                      {result.emptyReason ?? '没有符合条件的候选企业。'}
                    </p>
                    <p className='text-muted-foreground'>
                      如需调整条件，请新建研究并确认新的计划。
                    </p>
                  </div>
                )}
                {result.companies.map((item, index) => (
                  <button
                    key={item.id}
                    type='button'
                    aria-pressed={selected?.id === item.id}
                    onClick={() => {
                      setCompany(item.id)
                      setDetailKey(`${item.id}-${Date.now()}`)
                    }}
                    className={`w-full space-y-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === item.id ? 'border-primary/40 bg-primary/5' : 'bg-card hover:border-primary/30 hover:bg-muted/20'}`}
                  >
                    <span className='flex items-start gap-3'>
                      <span className='flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums'>
                        {index + 1}
                      </span>
                      <span className='min-w-0 flex-1 space-y-1'>
                        <span className='block text-sm font-semibold break-words'>
                          {item.name}
                        </span>
                        <span className='block text-xs text-muted-foreground'>
                          {countryName(item.country)} · Agent 推断关联 ·{' '}
                          {item.confidence === 'high' ? '高置信' : '中置信'}
                        </span>
                      </span>
                      <ArrowRight
                        className='mt-1 size-4 shrink-0 text-muted-foreground'
                        aria-hidden='true'
                      />
                    </span>
                    <span className='flex flex-wrap gap-2'>
                      <Badge variant='secondary'>
                        {item.patentCount} 条相关专利
                      </Badge>
                      <Badge variant='outline'>规则分 {item.ruleScore}</Badge>
                    </span>
                    <span className='block text-xs leading-5 text-muted-foreground'>
                      专利权利人：{item.assigneeNames.join('、')}
                    </span>
                  </button>
                ))}
              </section>
              <details className='rounded-xl border p-4'>
                <summary className='cursor-pointer text-sm font-medium'>
                  查看本次专利工作集
                </summary>
                <LazyPatents runId={runId!} />
              </details>
              {result.unresolvedSubjects.length > 0 && (
                <details className='rounded-xl border p-4'>
                  <summary className='cursor-pointer font-medium'>
                    查看未解析主体
                  </summary>
                  <div className='mt-3 space-y-3'>
                    {result.unresolvedSubjects.map((subject) => (
                      <div
                        key={subject.id}
                        className='rounded-md bg-muted p-3 text-sm'
                      >
                        <p className='font-medium break-words'>
                          {subject.name}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          {subject.patentCount} 条专利 · {subject.reason}
                        </p>
                        <p className='mt-1 text-xs break-all text-muted-foreground'>
                          代表专利：
                          {subject.representativePatentIds.join('、') || '无'}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
          {records}
        </div>
      }
      conversation={
        selected && runId ? (
          <div className='space-y-6'>
            <section className='space-y-4' aria-label='企业研究分析'>
              <div className='flex items-start gap-3'>
                <Building2
                  className='mt-1 size-5 shrink-0 text-muted-foreground'
                  aria-hidden='true'
                />
                <div className='min-w-0'>
                  <h3 className='text-lg font-semibold break-words'>
                    {selected.name}
                  </h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    企业注册地：{countryName(selected.country)} ·{' '}
                    {selected.patentCount} 条相关专利
                  </p>
                </div>
              </div>
              <div className='space-y-2 rounded-lg border bg-muted/20 p-4'>
                <h4 className='text-sm font-medium'>主体解析</h4>
                <p className='text-sm leading-6 break-words'>
                  {selected.resolutionReason}
                </p>
              </div>
              <div className='space-y-2 rounded-lg border bg-muted/20 p-4'>
                <h4 className='text-sm font-medium'>模型推断</h4>
                <p className='text-sm leading-7 break-words whitespace-pre-wrap'>
                  {selected.explanation ?? '本次未提供模型解释。'}
                </p>
              </div>
              <div className='space-y-2'>
                <h4 className='text-sm font-medium'>引用专利</h4>
                <div className='flex flex-wrap gap-2'>
                  {selected.citationIds.map((id) => (
                    <Button
                      key={id}
                      variant='outline'
                      size='sm'
                      className='h-auto max-w-full py-2 text-left whitespace-normal'
                      onClick={() => setPatent(id)}
                    >
                      <FileText className='shrink-0' aria-hidden='true' />
                      <span className='min-w-0 break-all'>{id}</span>
                    </Button>
                  ))}
                  {selected.citationIds.length === 0 && (
                    <p className='text-xs text-muted-foreground'>
                      本次未提供引用专利。
                    </p>
                  )}
                </div>
              </div>
              <div className='space-y-2'>
                <h4 className='text-sm font-medium'>公开年份统计</h4>
                <p className='text-xs leading-6 text-muted-foreground'>
                  {Object.entries(selected.trend)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([year, count]) => `${year} 年 ${count} 件`)
                    .join(' · ') || '暂无年份统计'}
                </p>
              </div>
            </section>
            <div className='border-t pt-5'>
              <CompanySnapshotDetails
                key={`${runId}-${selected.id}`}
                runId={runId}
                companyId={selected.id}
                citations={selected.citationIds}
              />
            </div>
            {patent && (
              <PatentSnapshot
                key={patent}
                runId={runId}
                patentId={patent}
                close={() => setPatent(null)}
              />
            )}
          </div>
        ) : (
          <div className='flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center'>
            <FileText
              className='size-8 text-muted-foreground'
              aria-hidden='true'
            />
            <h3 className='text-sm font-medium'>企业分析与引用依据</h3>
            <p className='max-w-sm text-sm leading-6 text-muted-foreground'>
              {runId && query.isPending
                ? '报告读取完成后将在这里显示企业分析。'
                : result?.companies.length === 0
                  ? '本次暂无候选企业，可在报告面板查看结果说明与研究记录。'
                  : '报告生成后，选择企业即可查看分析、快照与相关专利。'}
            </p>
          </div>
        )
      }
    />
  )
}

function LazyPatents({ runId }: { runId: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className='mt-4'>
      {show ? (
        <PatentList runId={runId} />
      ) : (
        <Button variant='outline' onClick={() => setShow(true)}>
          加载专利列表
        </Button>
      )}
    </div>
  )
}
