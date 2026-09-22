import { useInfiniteQuery } from '@tanstack/react-query'
import { ContentSkeleton } from '@/components/loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { nextCompanyListPage } from './company-list-data'
import { CompanyListPagination } from './company-list-pagination'

export function SubjectResolutions({ runId }: { runId: string }) {
  const query = useInfiniteQuery({
    queryKey: ['research', runId, 'subject-resolutions', 'infinite'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      researchApi.subjectResolutions(runId, pageParam),
    getNextPageParam: nextCompanyListPage,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages[0].total ?? 0
  return (
    <div className='flex flex-col gap-4'>
      <h3 className='text-sm font-semibold'>
        主体解析{query.data ? ` · ${total} 项` : ''}
      </h3>
      {query.isError && !query.isFetchNextPageError && (
        <p role='alert'>
          主体解析加载失败。
          <Button variant='link' onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      )}
      {query.isPending && (
        <ContentSkeleton variant='list' label='读取主体解析…' />
      )}
      {query.data && total === 0 && (
        <p className='rounded-xl border border-dashed p-6 text-sm text-muted-foreground'>
          本次没有需要解析的境内企业型权利人。
        </p>
      )}
      <ul aria-label='主体解析列表' className='divide-y border-y'>
        {items.map((item) => (
          <li key={item.id} className='space-y-2 px-2 py-3'>
            <div className='flex flex-wrap items-start justify-between gap-2'>
              <p className='text-sm font-medium break-words'>{item.name}</p>
              <Badge
                variant={item.status === 'matched' ? 'secondary' : 'outline'}
              >
                {item.status === 'matched'
                  ? `${item.confidence === 'high' ? '高' : '中'}置信推断`
                  : '未解析'}
              </Badge>
            </div>
            <p className='text-xs text-muted-foreground'>
              {item.patentCount} 条专利 · {item.candidateCount} 个企业候选
            </p>
            {item.companyName && (
              <p className='text-sm'>关联企业：{item.companyName}</p>
            )}
            {item.candidates.length > 0 && (
              <p className='text-xs leading-5 text-muted-foreground'>
                候选：
                {item.candidates.map((candidate) => candidate.name).join('、')}
              </p>
            )}
            <p className='text-xs leading-5 text-muted-foreground'>
              {item.reason}
            </p>
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
          paused={false}
        />
      )}
    </div>
  )
}
