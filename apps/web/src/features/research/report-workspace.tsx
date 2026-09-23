import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  FileText,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { ContentSkeleton } from '@/components/loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { CompanyDialog, CompanyNavigation } from './company-dialog'
import { countryName } from './labels'
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
  const companyOpenTrigger = useRef<HTMLButtonElement | null>(null)
  const patentReturnFocus = useRef<HTMLButtonElement | null>(null)
  const overviewRef = useRef<HTMLElement>(null)
  const patentsRef = useRef<HTMLElement>(null)
  const companiesRef = useRef<HTMLElement>(null)
  const recordsRef = useRef<HTMLElement>(null)
  const jumpTo = (
    section: 'overview' | 'patents' | 'companies' | 'records'
  ) => {
    const target = {
      overview: overviewRef,
      patents: patentsRef,
      companies: companiesRef,
      records: recordsRef,
    }[section]
    target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const result = query.data
  const selected = result?.companies.find((item) => item.id === company)
  const openPatent = (id: string, trigger: HTMLButtonElement) => {
    patentReturnFocus.current = trigger
    setPatent(id)
  }
  const selectCompany = (id: string) => {
    const index = result?.companies.findIndex((item) => item.id === id) ?? -1
    if (index < 0) return
    setVisibleCompanyCount((count) =>
      Math.max(count, 20 * Math.ceil((index + 1) / 20))
    )
    setCompany(id)
  }
  const priorityLabel = (value: 'high' | 'medium' | 'low') =>
    ({ high: '优先', medium: '关注', low: '参考' })[value]
  return (
    <>
      <section
        aria-label='研究报告内容'
        className='mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl border bg-card'
      >
        <div className='flex shrink-0 items-center gap-2 border-b px-4 py-3 sm:px-6'>
          <ChartNoAxesCombined
            className='size-4 text-muted-foreground'
            aria-hidden='true'
          />
          <h2 className='text-sm font-semibold'>报告概览与研究结果</h2>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          {result && (
            <nav
              aria-label='报告目录'
              className='sticky top-0 z-10 flex gap-1 overflow-x-auto border-b bg-card px-4 py-3 sm:px-6'
            >
              {(
                [
                  ['overview', '概览'],
                  ['patents', '重点专利'],
                  ['companies', '企业'],
                  ...(records ? ([['records', '研究记录']] as const) : []),
                ] as const
              ).map(([section, label]) => (
                <Button
                  key={section}
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='shrink-0'
                  onClick={() => jumpTo(section)}
                >
                  {label}
                </Button>
              ))}
            </nav>
          )}
          <div className='space-y-5 p-4 sm:p-6'>
            {controls}
            {notice}
            {runId && query.isPending && (
              <ContentSkeleton variant='workspace' label='正在读取报告…' />
            )}
            {runId && query.isError && (
              <p role='alert' className='text-sm'>
                报告加载失败。
              </p>
            )}
            {!runId && empty}
            {result && (
              <>
                <section
                  ref={overviewRef}
                  aria-label='报告概览'
                  className='scroll-mt-16 space-y-3'
                >
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
                        <dt className='text-xs text-muted-foreground'>
                          {label}
                        </dt>
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
                </section>
                <section
                  ref={patentsRef}
                  className='scroll-mt-16 space-y-3'
                  aria-label='专利优先级'
                >
                  <h3 className='text-sm font-semibold'>
                    专利优先级 · {result.patents.length} 件
                  </h3>
                  {result.patents.slice(0, visiblePatentCount).map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      aria-haspopup='dialog'
                      onClick={(event) =>
                        openPatent(item.id, event.currentTarget)
                      }
                      className='block w-full rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary/30 hover:bg-muted/20 focus-visible:outline-2 focus-visible:outline-ring'
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
                <section
                  ref={companiesRef}
                  className='scroll-mt-16 space-y-3'
                  aria-label='企业调研优先级'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <h3 className='text-sm font-semibold'>企业调研优先级</h3>
                    <span className='text-xs text-muted-foreground'>
                      {result.companies.length} 家 · 全部查询结果
                    </span>
                  </div>
                  {result.companies.length > 0 && (
                    <p className='text-xs text-muted-foreground'>
                      点击企业查看分析、引用专利与主体快照。
                    </p>
                  )}
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
                        aria-haspopup='dialog'
                        onClick={(event) => {
                          companyOpenTrigger.current = event.currentTarget
                          selectCompany(item.id)
                        }}
                        className='w-full space-y-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring'
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
            {records && (
              <section
                ref={recordsRef}
                aria-label='研究记录'
                className='scroll-mt-16'
              >
                {records}
              </section>
            )}
          </div>
        </div>
      </section>
      {selected && runId && result && (
        <CompanyDialog
          title={selected.name}
          description='本次研究中的企业分析、引用专利与主体快照。'
          contentKey={selected.id}
          fullscreenMobile
          close={() => setCompany(null)}
          returnFocus={() =>
            companyOpenTrigger.current?.focus({ preventScroll: true })
          }
          navigation={
            <CompanyNavigation
              ids={result.companies.map((item) => item.id)}
              selected={selected.id}
              select={selectCompany}
              total={result.companies.length}
            />
          }
        >
          <div className='space-y-6'>
            <section className='space-y-4' aria-label='企业研究分析'>
              <div className='flex items-start gap-3'>
                <Building2
                  className='mt-1 size-5 shrink-0 text-muted-foreground'
                  aria-hidden='true'
                />
                <div className='min-w-0'>
                  <h3 className='text-base font-semibold'>企业概况</h3>
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
                      aria-haspopup='dialog'
                      className='h-auto max-w-full py-2 text-left whitespace-normal'
                      onClick={(event) => openPatent(id, event.currentTarget)}
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
        </CompanyDialog>
      )}
      {patent && runId && (
        <PatentSnapshot
          key={patent}
          runId={runId}
          patentId={patent}
          close={() => setPatent(null)}
          returnFocus={() => patentReturnFocus.current?.focus()}
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
