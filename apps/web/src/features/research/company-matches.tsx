import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { ContentSkeleton } from '@/components/loading'
import { researchApi } from '@/lib/research-api'
import { CompanyNavigation } from './company-dialog'
import { nextCompanyListPage } from './company-list-data'
import { CompanyListPagination } from './company-list-pagination'
import { countryName } from './labels'
import { CompanySnapshot } from './snapshot-details'

export function CompanyMatches({ runId }: { runId: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
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
        企业查询结果{query.data ? ` · ${total} 家` : ''}
      </h3>

      {query.isError && !query.isFetchNextPageError && (
        <p role='alert'>企业列表加载失败。</p>
      )}
      {query.isPending && (
        <ContentSkeleton variant='list' label='正在读取企业查询结果…' />
      )}
      {query.data && total === 0 && (
        <p className='rounded-xl border border-dashed p-6 text-sm text-muted-foreground'>
          本次企业查询没有返回有效的境内企业。
        </p>
      )}
      <ul aria-label='企业查询结果列表' className='divide-y border-y'>
        {items.map((company) => (
          <li key={company.id}>
            <button
              type='button'
              aria-label={`查看依据：${company.name}`}
              aria-pressed={selected === company.id}
              onClick={(event) => {
                trigger.current = event.currentTarget
                setSelected(company.id)
              }}
              className='flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary/10'
            >
              <span className='min-w-0 flex-1 space-y-1.5'>
                <span className='block text-sm leading-6 font-medium break-words'>
                  {company.name}
                </span>
                <span className='block text-xs leading-5 break-words text-muted-foreground'>
                  {countryName(company.country)} · 查询命中：
                  {company.queryNames.join('、') || '未知权利人'} · 来源顺序{' '}
                  {company.providerRank + 1}
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
          returnFocus={() => trigger.current?.focus({ preventScroll: true })}
          navigation={
            <CompanyNavigation
              ids={items.map((item) => item.id)}
              selected={selected}
              select={setSelected}
              total={total}
              hasNextPage={query.hasNextPage}
              loadMore={async () => {
                const result = await query.fetchNextPage()
                if (result.isFetchNextPageError) throw result.error
                return (
                  result.data?.pages.flatMap((page) =>
                    page.items.map((item) => item.id)
                  ) ?? []
                )
              }}
            />
          }
          citations={[]}
          close={() => setSelected(null)}
        />
      )}
    </div>
  )
}
