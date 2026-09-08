import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { researchApi } from '@/lib/research-api'
import { ErrorNotice, Pager, SourceReference } from './shared'

export function PatentSnapshot({
  runId,
  patentId,
  close,
}: {
  runId: string
  patentId: string
  close: () => void
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
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>专利 {patentId}</DialogTitle>
          <DialogDescription>本次研究引用的快照依据。</DialogDescription>
        </DialogHeader>
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <p role='status'>读取专利…</p>}
        {patent && (
          <div className='space-y-3 text-sm'>
            <h3 className='font-semibold'>{patent.title}</h3>
            <p>
              {patent.dateKind === 'publication' ? '公开年份' : '授权年份'}：
              {patent.year ?? '缺失'}
            </p>
            <p className='break-words'>
              CPC：{patent.cpcs.join('、') || '缺失'}
            </p>
            <SourceReference source={patent.source} />
            <p className='whitespace-pre-wrap'>
              {patent.abstract ?? '该快照未提供摘要'}
            </p>
            {patent.parties.map((party, index) => (
              <p key={index}>
                {party.name} ·{' '}
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
            ))}
            {patent.claims && (
              <details>
                <summary>权利要求</summary>
                <p className='whitespace-pre-wrap'>{patent.claims}</p>
              </details>
            )}
            {patent.description && (
              <details>
                <summary>说明书</summary>
                <p className='whitespace-pre-wrap'>{patent.description}</p>
              </details>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  const query = useQuery({
    queryKey: ['research', runId, 'patents', companyId, page],
    queryFn: () => researchApi.patents(runId, page, companyId),
  })
  return (
    <div className='space-y-3'>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {query.isPending && <p role='status'>读取快照专利…</p>}
      {query.data?.items.map((p) => (
        <details key={p.id} className='rounded-lg border p-3'>
          <summary className='cursor-pointer text-sm font-medium'>
            {p.id} · {p.title}
            {citations.includes(p.id) ? ' · 模型引用' : ''}
          </summary>
          <div className='mt-3 space-y-2 text-sm'>
            <p>
              {p.dateKind === 'publication' ? '公开年份' : '授权年份'}：
              {p.year ?? '缺失'}
            </p>
            <p className='break-words'>CPC：{p.cpcs.join('、') || '缺失'}</p>
            <p>本次领域：{p.domains.join('、')}</p>
            <SourceReference source={p.source} />
            <p className='text-xs text-muted-foreground'>
              {p.abstract ?? '该快照未提供摘要'}
            </p>
          </div>
        </details>
      ))}
      {query.data && (
        <Pager page={page} total={query.data.total} onChange={setPage} />
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
  const query = useQuery({
    queryKey: ['research', runId, 'company', companyId],
    queryFn: () => researchApi.company(runId, companyId),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{query.data?.name ?? '主体快照'}</DialogTitle>
          <DialogDescription>
            这里展示本次研究保存的依据，不随目录更新而改变。
          </DialogDescription>
        </DialogHeader>
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
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
                <Link to='/companies' search={{ id: companyId }}>
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
      </DialogContent>
    </Dialog>
  )
}
