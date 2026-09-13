import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { ContentSkeleton, LoadingRegion } from '@/components/loading'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { countryName } from './labels'
import { Pager } from './shared'
import { CompanySnapshot } from './snapshot-details'

export function CompanyMatches({ runId }: { runId: string }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === runId ? previous : undefined,
    queryKey: ['research', runId, 'company-matches', page],
    queryFn: () => researchApi.companyMatches(runId, page),
  })
  return (
    <LoadingRegion
      busy={query.isPlaceholderData && query.isFetching}
      className='flex flex-col gap-4'
    >
      <h3 className='text-sm font-semibold'>
        已匹配企业{query.data ? ` · ${query.data.total} 家` : ''}
      </h3>

      {query.isError && (
        <p role='alert'>
          企业列表加载失败。
          <Button variant='link' onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      )}
      {query.isPending && (
        <ContentSkeleton variant='list' label='正在读取匹配企业…' />
      )}
      {query.data?.total === 0 && (
        <p className='rounded-xl border border-dashed p-6 text-sm text-muted-foreground'>
          尚无已匹配企业，可切换到核验列表处理候选主体。
        </p>
      )}
      <ul className='divide-y'>
        {query.data?.items.map((company) => (
          <li key={company.id}>
            <button
              type='button'
              aria-label={`查看依据：${company.name}`}
              aria-pressed={selected === company.id}
              onClick={() => setSelected(company.id)}
              className='flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/10'
            >
              <span className='min-w-0 flex-1 space-y-1'>
                <span className='block text-sm font-medium break-words'>
                  {company.name}
                </span>
                <span className='block text-xs text-muted-foreground'>
                  {countryName(company.country)} · {company.patentCount}{' '}
                  条相关专利
                </span>
              </span>
              <ChevronRight
                className='size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
            </button>
          </li>
        ))}
      </ul>
      {query.data && query.data.total > 0 && (
        <Pager page={page} total={query.data.total} onChange={setPage} />
      )}
      {selected && (
        <CompanySnapshot
          runId={runId}
          companyId={selected}
          citations={[]}
          close={() => setSelected(null)}
        />
      )}
    </LoadingRegion>
  )
}
