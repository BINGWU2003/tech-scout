import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  libraryDetailSchema,
  libraryListSchema,
  libraryRunsSchema,
  type LibraryRecord,
} from '@tech-scout/contracts'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorNotice, ResearchShell } from '@/features/research/shared'
import { apiRequest } from '@/lib/api-client'

const statuses: Record<string, string> = {
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
      {sources.map((s) => (
        <li key={s.runId} className='rounded-md border p-3'>
          <div>
            {s.directions.join('、')} · {statuses[s.status] ?? s.status}
          </div>
          <div className='text-muted-foreground'>
            采集时间：
            {s.observedAt ? new Date(s.observedAt).toLocaleString() : '未记录'}
          </div>
          {s.url &&
          /^https:\/\/(patents\.google\.com|(?:www\.)?riskbird\.com)\//.test(
            s.url
          ) ? (
            <a
              href={s.url}
              target='_blank'
              rel='noreferrer'
              className='underline'
            >
              查看来源网页
            </a>
          ) : null}
          <div className='text-xs break-all text-muted-foreground'>
            研究运行：{s.runId}
          </div>
        </li>
      ))}
    </ul>
  )
}
function Detail({ kind, id }: { kind: 'companies' | 'patents'; id: string }) {
  const detail = useQuery({
    queryKey: ['library', kind, id],
    queryFn: () =>
      apiRequest(
        `library/${kind}/${encodeURIComponent(id)}`,
        libraryDetailSchema
      ),
  })
  if (detail.isPending) return <p role='status'>正在加载详情…</p>
  if (detail.error) return <ErrorNotice error={detail.error} />
  const d = detail.data
  return (
    <article className='space-y-5'>
      <h2 className='text-xl font-semibold'>{d.name}</h2>
      <p className='text-muted-foreground'>{d.creditCode ?? d.id}</p>
      {kind === 'patents' ? (
        <>
          <p>公开日期：{d.date ?? '未提供'}</p>
          <p>原始申请人：{d.originalAssignees.join('；') || '未提供'}</p>
          <p>当前权利人：{d.currentAssignees.join('；') || '未提供'}</p>
          <p>CPC：{d.cpcs.join('、') || '未提供'}</p>
          {(
            [
              ['摘要', d.abstract],
              ['权利要求', d.claims],
              ['说明书', d.description],
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
          {Object.entries(d.businessInfo).map(([key, value]) => (
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
        {d.relations.length ? (
          <ul className='space-y-2'>
            {d.relations.map((r, i) => (
              <li key={`${r.runId}-${i}`} className='text-sm'>
                <Link
                  to={kind === 'companies' ? '/patents' : '/companies'}
                  search={{
                    id: kind === 'companies' ? r.patentId : r.companyId,
                  }}
                  className='underline'
                >
                  {kind === 'companies' ? r.patentId : r.companyId}
                </Link>{' '}
                · 当前权利人
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>
            暂无已确认关系。待核对及未找到的主体请在对应研究中查看。
          </p>
        )}
      </section>
      <section className='space-y-2'>
        <h3 className='font-semibold'>研究来源</h3>
        <SourceList sources={d.sources} />
      </section>
    </article>
  )
}
export function LibraryPage({
  kind,
  selectedId,
}: {
  kind: 'companies' | 'patents'
  selectedId?: string
}) {
  const [query, setQuery] = useState(''),
    [draft, setDraft] = useState(''),
    [runId, setRunId] = useState(''),
    [page, setPage] = useState(1)
  const runs = useQuery({
    queryKey: ['library', 'runs'],
    queryFn: () => apiRequest('library/runs', libraryRunsSchema),
  })
  const list = useQuery({
    queryKey: ['library', kind, { query, runId, page }],
    queryFn: () =>
      apiRequest(`library/${kind}`, libraryListSchema, {
        searchParams: {
          query,
          page,
          pageSize: 20,
          ...(runId ? { runId } : {}),
        },
      }),
    refetchInterval: 15000,
  })
  const title = kind === 'companies' ? '企业库' : '专利库'
  return (
    <ResearchShell>
      <div>
        <h1 className='text-2xl font-bold'>{title}</h1>
        <p className='mt-2 text-muted-foreground'>
          汇总确认检索后采集的真实数据，保留各次研究来源。
        </p>
      </div>
      <div className='flex flex-wrap items-center gap-3'>
        <Link to='/research' className='text-sm underline'>
          开始研究
        </Link>
        <span className='text-sm text-muted-foreground'>
          只有确认检索后才会采集和入库
        </span>
      </div>
      <form
        className='flex flex-wrap gap-3'
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(draft.trim())
          setPage(1)
        }}
      >
        <Input
          aria-label='检索名称或编号'
          placeholder={
            kind === 'companies' ? '企业名称或编号' : '专利名称或公开号'
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className='max-w-sm'
        />
        <select
          aria-label='按研究来源筛选'
          className='max-w-sm rounded-md border bg-background px-3 text-sm'
          value={runId}
          onChange={(e) => {
            setRunId(e.target.value)
            setPage(1)
          }}
        >
          <option value=''>全部研究来源</option>
          {runs.data?.map((r) => (
            <option key={r.runId} value={r.runId}>
              {r.directions.join('、')} · {r.runId.slice(0, 8)}
            </option>
          ))}
        </select>
        <Button type='submit'>检索</Button>
      </form>
      {runs.error ? <ErrorNotice error={runs.error} /> : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {list.isPending ? <p role='status'>正在加载数据…</p> : null}
      {list.data ? (
        <div className='space-y-4'>
          <p className='text-sm text-muted-foreground'>
            共 {list.data.total} 条记录
          </p>
          {list.data.items.length ? (
            <div className='overflow-x-auto rounded-lg border'>
              <table className='w-full text-left text-sm'>
                <thead className='bg-muted/50'>
                  <tr>
                    <th className='p-4'>名称</th>
                    <th className='p-4'>
                      {kind === 'companies' ? '统一社会信用代码' : '公开日期'}
                    </th>
                    <th className='p-4'>采集状态</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((row) => (
                    <tr key={row.id} className='border-t'>
                      <td className='p-4'>
                        <Link
                          to={kind === 'companies' ? '/companies' : '/patents'}
                          search={{ id: row.id }}
                          className='font-medium hover:underline'
                        >
                          {row.name}
                        </Link>
                        {kind === 'patents' ? (
                          <p className='mt-1 text-xs text-muted-foreground'>
                            {row.id}
                          </p>
                        ) : null}
                      </td>
                      <td className='p-4'>
                        {row.creditCode ?? row.date ?? '未提供'}
                      </td>
                      <td className='p-4'>
                        {[
                          ...new Set(
                            row.sources.map(
                              (s) => statuses[s.status] ?? s.status
                            )
                          ),
                        ].join('、')}
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {row.sources.length} 次研究
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className='rounded-lg border border-dashed p-10 text-center'>
              <h2 className='font-medium'>暂无匹配数据</h2>
              <p className='mt-2 text-sm text-muted-foreground'>
                {query || runId
                  ? '调整检索条件，或发起新的研究。'
                  : '输入技术方向并确认检索后，采集结果会出现在这里。'}
              </p>
            </div>
          )}
          <div className='flex items-center gap-3'>
            <Button
              variant='outline'
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <span className='text-sm'>第 {page} 页</span>
            <Button
              variant='outline'
              disabled={page * 20 >= list.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
      {selectedId ? (
        <section className='rounded-lg border p-5'>
          <div className='mb-4 flex justify-end'>
            <Link
              to={kind === 'companies' ? '/companies' : '/patents'}
              search={{}}
              className='text-sm underline'
            >
              关闭详情
            </Link>
          </div>
          <Detail key={`${kind}:${selectedId}`} kind={kind} id={selectedId} />
        </section>
      ) : null}
    </ResearchShell>
  )
}
