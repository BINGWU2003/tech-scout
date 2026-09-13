import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { ContentSkeleton } from '@/components/loading'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { nextCompanyListPage } from './company-list-data'
import { CompanyListPagination } from './company-list-pagination'
import { countryName } from './labels'
import { CompanySnapshot } from './snapshot-details'

export function CompanyMatches({ runId }: { runId: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['research', runId, 'company-matches', 'infinite'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => researchApi.companyMatches(runId, pageParam),
    getNextPageParam: nextCompanyListPage,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages[0].total ?? 0
  return (
    <div className='flex flex-col gap-4'>
      <h3 className='text-sm font-semibold'>
        已匹配企业{query.data ? ` · ${total} 家` : ''}
      </h3>

      {query.isError && !query.isFetchNextPageError && (
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
      {query.data && total === 0 && (
        <p className='rounded-xl border border-dashed p-6 text-sm text-muted-foreground'>
          尚无已匹配企业，可切换到核验列表处理候选主体。
        </p>
      )}
      <ul aria-label='已匹配企业列表' className='divide-y border-y'>
        {items.map((company) => (
          <li key={company.id}>
            <button
              type='button'
              aria-label={`查看依据：${company.name}`}
              aria-pressed={selected === company.id}
              onClick={() => setSelected(company.id)}
              className='flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary/10'
            >
              <span className='min-w-0 flex-1 space-y-1.5'>
                <span className='block text-sm leading-6 font-medium break-words'>
                  {company.name}
                </span>
                <span className='block text-xs leading-5 break-words text-muted-foreground'>
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
      {query.data && total > 0 && (
        <CompanyListPagination
          loaded={items.length}
          total={total}
          hasNextPage={query.hasNextPage}
          isFetching={query.isFetching}
          isFetchingNextPage={query.isFetchingNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          fetchNextPage={query.fetchNextPage}
          paused={Boolean(selected)}
        />
      )}
      {selected && (
        <CompanySnapshot
          runId={runId}
          companyId={selected}
          citations={[]}
          close={() => setSelected(null)}
        />
      )}
    </div>
  )
}
