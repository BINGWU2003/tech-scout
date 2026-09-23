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
  const [visiblePatentCount, setVisiblePatentCount] = useState(20)
  const [visibleCompanyCount, setVisibleCompanyCount] = useState(20)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const result = query.data
  const selected =
    result?.companies.find((item) => item.id === company) ??
    result?.companies[0]
  const priorityLabel = (value: 'high' | 'medium' | 'low') =>
    ({ high: '优先', medium: '关注', low: '参考' })[value]
  return (
    <>
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
                <dl
                  className='grid grid-cols-3 gap-2'
                  aria-label='研究报告统计'
                >
                  {[
                    ['去重专利', result.patentCount],
                    ['查询企业', result.companies.length],
                    [
                      '重点专利',
                      result.patents.filter((p) => p.priority === 'high')
                        .length,
                    ],
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
                    企业与专利的关系来自权利人名称查询，仅作为调研线索，不证明企业拥有这些专利。
                  </p>
                  {result.missing.length > 0 && (
                    <p>数据缺失：{result.missing.join('、')}</p>
                  )}
                  <p className='break-all'>研究快照：{result.releaseId}</p>
                </div>
                <section className='space-y-3' aria-label='专利优先级'>
                  <h3 className='text-sm font-semibold'>
                    专利优先级 · {result.patents.length} 件
                  </h3>
                  {result.patents.slice(0, visiblePatentCount).map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      onClick={() => setPatent(item.id)}
                      className='block w-full rounded-lg border p-3 text-left text-sm hover:border-primary/30'
                    >
                      <span className='font-medium'>
                        {item.id} · {priorityLabel(item.priority)}
                      </span>
                      <span className='mt-1 block text-xs text-muted-foreground'>
                        {item.reason}
                      </span>
                    </button>
                  ))}
                  {visiblePatentCount < result.patents.length && (
                    <Button
                      variant='outline'
                      onClick={() =>
                        setVisiblePatentCount((count) => count + 20)
                      }
                    >
                      加载更多专利
                    </Button>
                  )}
                </section>
                <section className='space-y-3' aria-label='企业调研优先级'>
                  <div className='flex items-center justify-between gap-2'>
                    <h3 className='text-sm font-semibold'>企业调研优先级</h3>
                    <span className='text-xs text-muted-foreground'>
                      {result.companies.length} 家 · 全部查询结果
                    </span>
                  </div>
                  {result.companies.length === 0 && (
                    <div
                      role='status'
                      className='space-y-2 rounded-lg border border-dashed p-5 text-sm'
                    >
                      <h3 className='font-medium'>本次没有企业查询结果</h3>
                      <p className='text-muted-foreground'>
                        {result.emptyReason ?? '专利分析仍可在上方查看。'}
                      </p>
                      <p className='text-muted-foreground'>
                        如需调整条件，请新建研究并确认新的计划。
                      </p>
                    </div>
                  )}
                  {result.companies
                    .slice(0, visibleCompanyCount)
                    .map((item, index) => (
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
                              {countryName(item.country)} ·{' '}
                              {priorityLabel(item.priority)}调研 · 查询线索
                            </span>
                          </span>
                          <ArrowRight
                            className='mt-1 size-4 shrink-0 text-muted-foreground'
                            aria-hidden='true'
                          />
                        </span>
                        <span className='flex flex-wrap gap-2'>
                          <Badge variant='secondary'>
                            {item.leadPatentCount} 条关联专利线索
                          </Badge>
                        </span>
                        <span className='block text-xs leading-5 text-muted-foreground'>
                          查询权利人：{item.assigneeNames.join('、')}
                        </span>
                      </button>
                    ))}
                  {visibleCompanyCount < result.companies.length && (
                    <Button
                      variant='outline'
                      onClick={() =>
                        setVisibleCompanyCount((count) => count + 20)
                      }
                    >
                      加载更多企业
                    </Button>
                  )}
                </section>
                <details className='rounded-xl border p-4'>
                  <summary className='cursor-pointer text-sm font-medium'>
                    查看本次专利工作集
                  </summary>
                  <LazyPatents runId={runId!} />
                </details>
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
                      {selected.leadPatentCount} 条关联专利线索
                    </p>
                  </div>
                </div>
                <div className='space-y-2 rounded-lg border bg-muted/20 p-4'>
                  <h4 className='text-sm font-medium'>查询权利人</h4>
                  <p className='text-sm leading-6 break-words'>
                    {selected.assigneeNames.join('、') || '无'}
                  </p>
                </div>
                <div className='space-y-2 rounded-lg border bg-muted/20 p-4'>
                  <h4 className='text-sm font-medium'>调研分析</h4>
                  <p className='text-sm leading-7 break-words whitespace-pre-wrap'>
                    {selected.summary}
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
                  <p className='text-xs leading-6 text-muted-foreground'>
                    以上专利均为查询线索，权属需另行核实。
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
                    ? '本次暂无企业查询结果，专利分析仍可在报告面板查看。'
                    : '报告生成后，选择企业即可查看分析、快照与相关专利。'}
              </p>
            </div>
          )
        }
      />
      {patent && runId && (
        <PatentSnapshot
          key={patent}
          runId={runId}
          patentId={patent}
          close={() => setPatent(null)}
        />
      )}
    </>
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
