import { useEffect, useRef } from 'react'
import { LoadingIndicator } from '@/components/loading'

export function CompanyListPagination({
  loaded,
  total,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
  paused = false,
}: {
  loaded: number
  total: number
  hasNextPage: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: (options: { cancelRefetch: boolean }) => Promise<unknown>
  paused?: boolean
}) {
  const loadMore = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hasNextPage || isFetching || isFetchNextPageError || paused) return
    const target = loadMore.current
    if (!target) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void fetchNextPage({ cancelRefetch: false })
      }
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetching, isFetchNextPageError, paused])

  return (
    <div
      ref={loadMore}
      className='flex min-h-12 flex-wrap items-center justify-center gap-2 py-2 text-xs text-muted-foreground [overflow-anchor:none]'
    >
      <span>
        已加载 {loaded} / {total} 项
      </span>
      {isFetchingNextPage ? (
        <LoadingIndicator label='正在加载更多…' />
      ) : isFetchNextPageError ? (
        <span role='alert'>加载失败，已保留现有列表。</span>
      ) : hasNextPage ? (
        <span>向下滚动加载更多</span>
      ) : (
        <span role='status'>已全部加载</span>
      )}
    </div>
  )
}
