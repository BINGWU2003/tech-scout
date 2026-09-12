import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { withLibraryDetail } from '@/features/library/library-navigation'
import { researchApi } from '@/lib/research-api'
import { Pager, SourceReference } from './shared'

export function PatentSnapshot({
  runId,
  patentId,
  close,
  navigation,
  returnFocus,
}: {
  runId: string
  patentId: string
  close: () => void
  navigation?: ReactNode
  returnFocus?: () => void
}) {
  const query = useQuery({
    queryKey: ['research', runId, 'patent', patentId],
    queryFn: () => researchApi.patent(runId, patentId),
  })
  const patent = query.data?.items[0]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className='flex h-[88dvh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]'
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                event.preventDefault()
                returnFocus()
              }
            : undefined
        }
      >
        <DialogHeader className='shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-7 sm:pr-12'>
          <DialogTitle
            className='line-clamp-3 text-lg leading-7 break-words'
            title={patent?.title}
          >
            {patent?.title ?? `专利 ${patentId}`}
          </DialogTitle>
          <DialogDescription className='break-words'>
            {patentId} · 本次研究快照
          </DialogDescription>
          {patent?.source.url && (
            <a
              href={patent.source.url}
              target='_blank'
              rel='noreferrer'
              className='w-fit text-sm text-primary underline underline-offset-4'
            >
              查看原始资料
            </a>
          )}
        </DialogHeader>
        {query.isPending && (
          <p role='status' className='flex-1 p-7 text-sm'>
            读取专利…
          </p>
        )}
        {query.isError && (
          <div role='alert' className='flex-1 space-y-3 p-7 text-sm'>
            <p>专利详情加载失败，请重试。</p>
            <Button variant='outline' onClick={() => void query.refetch()}>
              重新加载
            </Button>
          </div>
        )}
        {query.isSuccess && !patent && (
          <p className='flex-1 p-7 text-sm text-muted-foreground'>
            本次研究中未找到该专利。
          </p>
        )}
        {patent && (
          <Tabs
            key={patentId}
            defaultValue='overview'
            className='min-h-0 flex-1 gap-0'
          >
            <div className='shrink-0 px-5 py-3 sm:px-7'>
              <TabsList aria-label='专利详情内容' className='w-full sm:w-auto'>
                <TabsTrigger value='overview'>概览</TabsTrigger>
                <TabsTrigger value='claims'>权利要求</TabsTrigger>
                <TabsTrigger value='description'>说明书</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value='overview'
              className='min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 text-sm sm:px-7'
            >
              <div className='space-y-6'>
                <dl className='grid gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-2'>
                  <div>
                    <dt className='text-xs text-muted-foreground'>
                      {patent.dateKind === 'publication'
                        ? '公开年份'
                        : '授权年份'}
                    </dt>
                    <dd className='mt-1'>{patent.year ?? '未提供'}</dd>
                  </div>
                  <div>
                    <dt className='text-xs text-muted-foreground'>
                      技术分类（IPC）
                    </dt>
                    <dd className='mt-1 break-words'>
                      {patent.cpcs.join('、') || '未提供'}
                    </dd>
                  </div>
                  <div className='sm:col-span-2'>
                    <dt className='text-xs text-muted-foreground'>本次领域</dt>
                    <dd className='mt-1 break-words'>
                      {patent.domains.join('、') || '未提供'}
                    </dd>
                  </div>
                </dl>
                <section className='space-y-2'>
                  <h3 className='font-semibold'>摘要</h3>
                  <p className='leading-7 break-words whitespace-pre-wrap'>
                    {patent.abstract || '该快照未提供摘要'}
                  </p>
                </section>
                <section className='space-y-3'>
                  <h3 className='font-semibold'>申请人 / 权利人</h3>
                  {patent.parties.length === 0 && (
                    <p className='text-muted-foreground'>
                      该快照未提供申请人或权利人信息
                    </p>
                  )}
                  {patent.parties.map((party, index) => (
                    <div
                      key={index}
                      className='space-y-1 border-b pb-3 last:border-0'
                    >
                      <p className='break-words'>{party.name}</p>
                      <p className='text-xs text-muted-foreground'>
                        {party.roles
                          .map(
                            (role) =>
                              (
                                ({
                                  search_listing: '检索列表名称',
                                  current_assignee: '当前权利人',
                                  original_assignee: '原始申请人',
                                }) as Record<string, string>
                              )[role] ?? role
                          )
                          .join('、')}
                      </p>
                    </div>
                  ))}
                </section>
                <details className='border-t pt-4'>
                  <summary className='cursor-pointer text-xs text-muted-foreground'>
                    快照来源与校验信息
                  </summary>
                  <SourceReference source={patent.source} />
                </details>
              </div>
            </TabsContent>
            <TabsContent
              value='claims'
              className='min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-7'
            >
              <p className='text-sm leading-7 break-words whitespace-pre-wrap'>
                {patent.claims || '该快照未提供权利要求'}
              </p>
            </TabsContent>
            <TabsContent
              value='description'
              className='min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-7'
            >
              <p className='text-sm leading-7 break-words whitespace-pre-wrap'>
                {patent.description || '该快照未提供说明书'}
              </p>
            </TabsContent>
          </Tabs>
        )}
        <footer className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3 sm:px-7'>
          {navigation ?? (
            <span className='text-xs text-muted-foreground'>
              本次研究保存的引用依据
            </span>
          )}
          <DialogClose asChild>
            <Button variant='ghost' size='sm'>
              关闭详情
            </Button>
          </DialogClose>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

type PatentPage = Awaited<ReturnType<typeof researchApi.patents>>

function PatentReader({
  runId,
  companyId,
  initial,
  close,
  returnFocus,
}: {
  runId: string
  companyId?: string
  initial: { data: PatentPage; index: number }
  close: () => void
  returnFocus: () => void
}) {
  const client = useQueryClient()
  const [selection, setSelection] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const { data, index } = selection
  const position = (data.page - 1) * data.pageSize + index + 1
  async function navigate(step: number) {
    if (pending) return
    const nextIndex = index + step
    setError(false)
    if (nextIndex >= 0 && nextIndex < data.items.length) {
      setSelection({ data, index: nextIndex })
      return
    }
    setPending(true)
    try {
      const nextPage = data.page + step
      const next = await client.fetchQuery({
        queryKey: ['research', runId, 'patents', companyId, nextPage],
        queryFn: () => researchApi.patents(runId, nextPage, companyId),
      })
      if (!next.items.length) throw new Error('No patents on page')
      setSelection({ data: next, index: step > 0 ? 0 : next.items.length - 1 })
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <PatentSnapshot
      runId={runId}
      patentId={data.items[index].id}
      close={close}
      returnFocus={returnFocus}
      navigation={
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={pending || position <= 1}
            onClick={() => void navigate(-1)}
          >
            上一篇
          </Button>
          <span role='status' className='text-xs text-muted-foreground'>
            {pending ? '正在切换…' : `${position} / ${data.total}`}
          </span>
          <Button
            size='sm'
            variant='outline'
            disabled={pending || position >= data.total}
            onClick={() => void navigate(1)}
          >
            下一篇
          </Button>
          {error && (
            <p role='alert' className='w-full text-xs text-destructive'>
              切换失败，请再次点击重试。
            </p>
          )}
        </div>
      }
    />
  )
}

export function PatentList({
  runId,
  companyId,
  citations = [],
}: {
  runId: string
  companyId?: string
  citations?: string[]
}) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<{
    data: PatentPage
    index: number
  } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const query = useQuery({
    queryKey: ['research', runId, 'patents', companyId, page],
    queryFn: () => researchApi.patents(runId, page, companyId),
  })
  return (
    <div className='space-y-3'>
      {query.isPending && <p role='status'>读取快照专利…</p>}
      {query.isError && (
        <div role='alert' className='text-sm'>
          专利列表加载失败。
          <Button size='sm' variant='link' onClick={() => void query.refetch()}>
            重新加载
          </Button>
        </div>
      )}
      {query.data?.total === 0 && (
        <p className='rounded-xl border border-dashed p-6 text-sm text-muted-foreground'>
          本次没有符合条件的专利，可以调整研究条件后重新检索。
        </p>
      )}
      <ul className='space-y-3'>
        {query.data?.items.map((p, index) => (
          <li
            key={p.id}
            className='space-y-2 rounded-lg border p-4 transition-colors hover:border-primary/30 hover:bg-muted/20'
          >
            <div className='flex items-start gap-2'>
              <button
                type='button'
                className='min-w-0 rounded-sm text-left text-sm leading-6 font-medium break-words hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                onClick={(event) => {
                  trigger.current = event.currentTarget
                  setSelected({ data: query.data!, index })
                }}
              >
                {p.title}
              </button>
              {citations.includes(p.id) && (
                <Badge variant='secondary' className='mt-1 shrink-0'>
                  模型引用
                </Badge>
              )}
            </div>
            <p className='text-xs leading-5 break-words text-muted-foreground'>
              {p.id} · {p.dateKind === 'publication' ? '公开' : '授权'}{' '}
              {p.year ?? '年份未提供'} · IPC：{p.cpcs.join('、') || '未提供'}
            </p>
            <p className='line-clamp-2 text-xs leading-5 break-words text-muted-foreground'>
              {p.abstract || '该快照未提供摘要'}
            </p>
          </li>
        ))}
      </ul>
      {selected && (
        <PatentReader
          runId={runId}
          companyId={companyId}
          initial={selected}
          close={() => setSelected(null)}
          returnFocus={() => trigger.current?.focus({ preventScroll: true })}
        />
      )}
      {query.data && (
        <Pager
          page={page}
          total={query.data.total}
          pageSize={query.data.pageSize}
          onChange={setPage}
        />
      )}
    </div>
  )
}

export function CompanySnapshot({
  runId,
  companyId,
  citations,
  close,
}: {
  runId: string
  companyId: string
  citations: string[]
  close: () => void
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent className='w-full overflow-y-auto p-6 sm:max-w-3xl'>
        <SheetHeader>
          <SheetTitle>主体快照</SheetTitle>
          <SheetDescription>
            这里展示本次研究保存的依据，不随目录更新而改变。
          </SheetDescription>
        </SheetHeader>
        <CompanySnapshotDetails
          runId={runId}
          companyId={companyId}
          citations={citations}
        />
      </SheetContent>
    </Sheet>
  )
}

export function CompanySnapshotDetails({
  runId,
  companyId,
  citations,
}: {
  runId: string
  companyId: string
  citations: string[]
}) {
  const query = useQuery({
    queryKey: ['research', runId, 'company', companyId],
    queryFn: () => researchApi.company(runId, companyId),
  })
  return (
    <section aria-label='企业快照与来源' className='space-y-4'>
      <h3 className='text-sm font-semibold'>
        {query.data?.name ?? '主体快照'}
      </h3>
      <p className='text-xs text-muted-foreground'>
        本次研究保存的依据，不随企业库更新而改变。
      </p>
      {query.isError && (
        <p role='alert' className='text-sm'>
          企业快照加载失败。
          <Button variant='link' size='sm' onClick={() => void query.refetch()}>
            重新加载
          </Button>
        </p>
      )}
      {query.isPending && <p role='status'>读取快照…</p>}
      {query.data && (
        <div className='space-y-5'>
          <div className='space-y-2 text-sm'>
            <p>
              法律名称：{query.data.legalName ?? '缺失'} · 国家：
              {query.data.country ?? '缺失'}
            </p>
            <p className='break-words'>
              别名：{query.data.aliases.join('、') || '无'}
            </p>
            <p className='break-all'>
              外部标识：
              {query.data.identifiers
                .map((i) => `${i.type}: ${i.value}`)
                .join('；') || '无'}
            </p>
            {Object.entries(query.data.businessInfo).map(([label, value]) => (
              <p key={label}>
                {label}：{value}
              </p>
            ))}
            <SourceReference source={query.data.source} />
            <Button asChild variant='outline' size='sm'>
              <Link
                to='/companies'
                search={{}}
                state={withLibraryDetail('companies', companyId)}
              >
                查看企业库资料
              </Link>
            </Button>
            <p className='text-xs text-muted-foreground'>
              企业库会持续更新，本次研究快照保持不变。
            </p>
          </div>
          <section className='space-y-3'>
            <h3 className='font-semibold'>本次相关专利</h3>
            <PatentList
              runId={runId}
              companyId={companyId}
              citations={citations}
            />
          </section>
          <details className='rounded-lg border p-3'>
            <summary className='cursor-pointer font-medium'>
              关联依据（{query.data.relations.length} 条）
            </summary>
            <ul className='mt-3 max-h-60 space-y-1 overflow-y-auto text-xs'>
              {query.data.relations.map((r, i) => (
                <li key={i}>
                  {r.patentId} · {r.method} · {r.decision ?? '本次人工确认'}
                </li>
              ))}
            </ul>
          </details>
          {query.data.confirmations.map((c, i) => (
            <div key={i} className='rounded-lg border p-3 text-sm'>
              <p className='font-medium'>本次人工确认记录</p>
              <p>
                {c.confirmedAt} · 确认者 {c.actorId}
              </p>
              <p>{c.note || '未填写说明'}</p>
              <p className='text-xs break-all'>
                证据：{c.evidenceIds.join('、')}
              </p>
            </div>
          ))}
          <details className='rounded-lg border p-3'>
            <summary className='cursor-pointer font-medium'>
              身份来源（{query.data.evidence.length} 条）
            </summary>
            <p className='my-2 text-xs text-muted-foreground'>
              身份依据不证明产品能力；来源正文当前不可用。
            </p>
            {query.data.evidence.map((e) => (
              <div key={e.id} className='my-3 border-t pt-3 text-sm'>
                <p>
                  {e.publisher ?? '未知发布者'} · {e.legalName ?? e.id}
                </p>
                <p>
                  {e.identifierType}: {e.identifierValue ?? '无标识'} ·{' '}
                  {e.observedAt ?? '观察时间缺失'}
                </p>
                <SourceReference source={e.source} />
              </div>
            ))}
          </details>
        </div>
      )}
    </section>
  )
}
