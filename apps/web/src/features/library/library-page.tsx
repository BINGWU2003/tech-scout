import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, Link } from '@tanstack/react-router'
import { type PaginationState } from '@tanstack/react-table'
import {
  libraryListSchema,
  libraryRunsSchema,
  type LibraryRecord,
} from '@tech-scout/contracts'
import { useEffect, useState } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/features/research/shared'
import { apiRequest } from '@/lib/api-client'
import { LibraryDetailDialog } from './library-detail-dialog'
import { type LibraryKind, type LibrarySearch } from './library-navigation'
import { LibraryTable, type LibraryRun } from './library-table'

const EMPTY_RECORDS: LibraryRecord[] = []
const EMPTY_RUNS: LibraryRun[] = []

export function LibraryPage({
  kind,
  search,
  onSearchChange,
}: {
  kind: LibraryKind
  search: LibrarySearch
  onSearchChange: (search: LibrarySearch, replace?: boolean) => void
}) {
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20
  const query = search.query ?? ''
  const runId = search.runId ?? ''
  const incomingDetail = useLocation({
    select: (location) => location.state.libraryDetail,
  })
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    incomingDetail?.kind === kind ? incomingDetail.id : null
  )
  const navigate = useNavigate()
  const runs = useQuery({
    queryKey: ['library', 'runs'],
    queryFn: () => apiRequest('library/runs', libraryRunsSchema),
  })
  const list = useQuery({
    queryKey: ['library', kind, { query, runId, page, pageSize }],
    queryFn: () =>
      apiRequest(`library/${kind}`, libraryListSchema, {
        searchParams: {
          query,
          page,
          pageSize,
          ...(runId ? { runId } : {}),
        },
      }),
    refetchInterval: 15000,
  })
  const pageCount = Math.ceil((list.data?.total ?? 0) / pageSize)
  const title = kind === 'companies' ? '企业库' : '专利库'

  useEffect(() => {
    if (!incomingDetail || incomingDetail.kind !== kind) return
    void navigate({
      replace: true,
      resetScroll: false,
      state: (previous) => ({ ...previous, libraryDetail: undefined }),
    })
  }, [incomingDetail, kind, navigate])

  useEffect(() => {
    if (pageCount > 0 && page > pageCount) {
      onSearchChange({ ...search, page: pageCount }, true)
    }
  }, [onSearchChange, page, pageCount, search])

  const handlePaginationChange = (
    updater: PaginationState | ((previous: PaginationState) => PaginationState)
  ) => {
    const current = { pageIndex: page - 1, pageSize }
    const next = typeof updater === 'function' ? updater(current) : updater
    onSearchChange({
      ...search,
      page: next.pageIndex + 1 <= 1 ? undefined : next.pageIndex + 1,
      pageSize:
        next.pageSize === 20
          ? undefined
          : (next.pageSize as Exclude<LibrarySearch['pageSize'], undefined>),
    })
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>{title}</h2>
            <p className='text-muted-foreground'>
              汇总确认检索后采集的真实数据，保留各次研究来源。
            </p>
          </div>
          <Button asChild>
            <Link to='/research'>开始研究</Link>
          </Button>
        </div>

        {runs.error ? (
          <ErrorNotice error={runs.error} retry={() => void runs.refetch()} />
        ) : null}
        {list.error ? (
          <ErrorNotice error={list.error} retry={() => void list.refetch()} />
        ) : null}
        <LibraryTable
          kind={kind}
          data={list.data?.items ?? EMPTY_RECORDS}
          total={list.data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          pageCount={pageCount}
          query={query}
          runId={runId}
          runs={runs.data ?? EMPTY_RUNS}
          isLoading={list.isLoading}
          runsLoading={runs.isLoading}
          onQueryChange={(value) =>
            onSearchChange({
              ...search,
              page: undefined,
              query: value.trim() || undefined,
            })
          }
          onRunIdChange={(value) =>
            onSearchChange({
              ...search,
              page: undefined,
              runId: value || undefined,
            })
          }
          onReset={() =>
            onSearchChange({
              ...search,
              page: undefined,
              query: undefined,
              runId: undefined,
            })
          }
          onPaginationChange={handlePaginationChange}
          onOpenDetail={setSelectedId}
        />
      </Main>

      <LibraryDetailDialog
        kind={kind}
        selectedId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  )
}
