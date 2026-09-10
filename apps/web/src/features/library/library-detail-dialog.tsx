import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { libraryDetailSchema, type LibraryRecord } from '@tech-scout/contracts'
import { type z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorNotice } from '@/features/research/shared'
import { apiRequest } from '@/lib/api-client'
import { type LibraryKind, withLibraryDetail } from './library-navigation'

type LibraryDetail = z.infer<typeof libraryDetailSchema>

const allowedSourceUrl =
  /^(?:https:\/\/patents\.google\.com|https:\/\/m\.tianyancha\.com)\//

const statusLabels: Record<string, string> = {
  completed: '采集完成',
  running: '采集中',
  queued: '等待采集',
  paused: '已暂停',
  waiting: '等待登录或验证',
  failed: '采集失败',
}

function SourceList({ sources }: { sources: LibraryRecord['sources'] }) {
  return (
    <ul className='space-y-2 text-sm'>
      {sources.map((source) => (
        <li key={source.runId} className='rounded-md border p-3'>
          <div>
            {source.directions.join('、')} ·{' '}
            {statusLabels[source.status] ?? source.status}
          </div>
          <div className='text-muted-foreground'>
            采集时间：
            {source.observedAt
              ? new Date(source.observedAt).toLocaleString()
              : '未记录'}
          </div>
          {source.url && allowedSourceUrl.test(source.url) ? (
            <a
              href={source.url}
              target='_blank'
              rel='noreferrer'
              className='underline'
            >
              查看来源网页
            </a>
          ) : null}
          <div className='text-xs break-all text-muted-foreground'>
            研究运行：{source.runId}
          </div>
        </li>
      ))}
    </ul>
  )
}

function DetailContent({
  kind,
  detail,
}: {
  kind: LibraryKind
  detail: LibraryDetail
}) {
  const targetKind = kind === 'companies' ? 'patents' : 'companies'
  return (
    <article className='space-y-5'>
      {kind === 'patents' ? (
        <>
          <p>公开日期：{detail.date ?? '未提供'}</p>
          <p>原始申请人：{detail.originalAssignees.join('；') || '未提供'}</p>
          <p>当前权利人：{detail.currentAssignees.join('；') || '未提供'}</p>
          <p>IPC：{detail.cpcs.join('、') || '未提供'}</p>
          {(
            [
              ['摘要', detail.abstract],
              ['权利要求', detail.claims],
              ['说明书', detail.description],
            ] as const
          ).map(([title, value]) => (
            <details
              key={title}
              open={title === '摘要'}
              className='rounded-lg border p-4'
            >
              <summary className='cursor-pointer font-medium'>{title}</summary>
              <p className='mt-3 text-sm leading-7 whitespace-pre-wrap'>
                {value || '来源未提供'}
              </p>
            </details>
          ))}
        </>
      ) : (
        <dl className='grid gap-3 sm:grid-cols-2'>
          {Object.entries(detail.businessInfo).map(([key, value]) => (
            <div key={key} className='rounded-md bg-muted/40 p-3'>
              <dt className='text-sm text-muted-foreground'>{key}</dt>
              <dd className='mt-1 break-words'>
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <section className='space-y-2'>
        <h3 className='font-semibold'>已确认的专利归属</h3>
        {detail.relations.length ? (
          <ul className='space-y-2'>
            {detail.relations.map((relation, index) => {
              const targetId =
                kind === 'companies' ? relation.patentId : relation.companyId
              return (
                <li key={`${relation.runId}-${index}`} className='text-sm'>
                  <Link
                    to={kind === 'companies' ? '/patents' : '/companies'}
                    search={{}}
                    state={withLibraryDetail(targetKind, targetId)}
                    className='underline'
                  >
                    {targetId}
                  </Link>{' '}
                  · 当前权利人
                </li>
              )
            })}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>
            暂无已确认关系。待核对及未找到的主体请在对应研究中查看。
          </p>
        )}
      </section>
      <section className='space-y-2'>
        <h3 className='font-semibold'>研究来源</h3>
        <SourceList sources={detail.sources} />
      </section>
    </article>
  )
}

export function LibraryDetailDialog({
  kind,
  selectedId,
  onClose,
}: {
  kind: LibraryKind
  selectedId: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: ['library', kind, 'detail', selectedId],
    queryFn: () =>
      apiRequest(
        `library/${kind}/${encodeURIComponent(selectedId ?? '')}`,
        libraryDetailSchema
      ),
    enabled: selectedId !== null,
  })

  return (
    <Dialog
      open={selectedId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {detail.data?.name ??
              (kind === 'companies' ? '企业详情' : '专利详情')}
          </DialogTitle>
          <DialogDescription>
            {detail.data?.creditCode ?? selectedId ?? '正在读取记录信息'}
          </DialogDescription>
        </DialogHeader>
        {detail.isPending && selectedId ? (
          <p role='status'>正在加载详情…</p>
        ) : null}
        {detail.error ? (
          <ErrorNotice
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        ) : null}
        {detail.data ? (
          <DetailContent kind={kind} detail={detail.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
