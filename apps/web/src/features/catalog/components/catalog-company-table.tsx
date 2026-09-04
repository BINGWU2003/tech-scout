import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table'
import {
  type CatalogCompanyList,
  type CatalogCompanyListQuery,
  type CatalogCompanySummary,
} from '@tech-scout/contracts'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DataTablePagination } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import { cn } from '@/lib/utils'
import {
  CatalogCompanyDetailDialog,
  type CatalogCompanyReference,
} from './catalog-company-detail-dialog'
import { CatalogTableTooltip } from './catalog-table-tooltip'

function createColumns(
  onOpen: (company: CatalogCompanyReference, trigger: HTMLButtonElement) => void
): ColumnDef<CatalogCompanySummary>[] {
  return [
    {
      accessorKey: 'preferredName',
      header: '公司',
      meta: { className: 'w-[34%] max-w-0' },
      cell: ({ row }) => {
        const secondaryName = row.original.legalName ?? row.original.companyId

        return (
          <div className='flex min-w-0 flex-col items-start'>
            <CatalogTableTooltip content={row.original.preferredName}>
              <Button
                className='h-auto max-w-full justify-start truncate p-0 align-bottom'
                type='button'
                variant='link'
                onClick={(event) => onOpen(row.original, event.currentTarget)}
              >
                {row.original.preferredName}
              </Button>
            </CatalogTableTooltip>
            <CatalogTableTooltip content={secondaryName}>
              <span
                className='mt-1 inline-block max-w-full truncate align-bottom text-xs text-muted-foreground'
                tabIndex={0}
              >
                {secondaryName}
              </span>
            </CatalogTableTooltip>
          </div>
        )
      },
    },
    {
      accessorKey: 'country',
      header: '国家/地区',
      meta: { className: 'w-[13%]' },
      cell: ({ row }) => row.original.country ?? '未知',
    },
    {
      accessorKey: 'provider',
      header: '身份来源',
      meta: { className: 'w-[14%]' },
      cell: ({ row }) => (
        <Badge variant='outline'>{row.original.provider}</Badge>
      ),
    },
    {
      accessorKey: 'patentCount',
      header: '相关专利',
      meta: { className: 'w-[12%]' },
      cell: ({ row }) => (
        <span className='tabular-nums'>{row.original.patentCount}</span>
      ),
    },
    {
      accessorKey: 'latestPatentDate',
      header: '最近授权',
      meta: { className: 'w-[15%]' },
      cell: ({ row }) => row.original.latestPatentDate ?? '未知',
    },
    {
      accessorKey: 'entityStatus',
      header: '主体状态',
      meta: { className: 'w-[12%]' },
      cell: ({ row }) => row.original.entityStatus ?? '未知',
    },
  ]
}

type CatalogCompanyTableProps = {
  result: CatalogCompanyList
  query: CatalogCompanyListQuery
  onQueryChange: (patch: Partial<CatalogCompanyListQuery>) => void
}

export function CatalogCompanyTable({
  result,
  query,
  onQueryChange,
}: CatalogCompanyTableProps) {
  const [search, setSearch] = useState(query.query ?? '')
  const [country, setCountry] = useState(query.country ?? '')
  const [companyHistory, setCompanyHistory] = useState<
    CatalogCompanyReference[]
  >([])
  const companyTriggerRef = useRef<HTMLButtonElement>(null)
  const activeCompany = companyHistory[companyHistory.length - 1] ?? null
  const columns = useMemo(
    () =>
      createColumns((company, trigger) => {
        companyTriggerRef.current = trigger
        setCompanyHistory([company])
      }),
    []
  )
  const hasFilters = search.trim() !== '' || country.trim() !== ''
  const { cancel: cancelSearchQuery, run: runSearchQuery } =
    useDebouncedCallback(
      (value: string) =>
        onQueryChange({ page: 1, query: value.trim() || undefined }),
      300
    )
  const { cancel: cancelCountryQuery, run: runCountryQuery } =
    useDebouncedCallback(
      (value: string) =>
        onQueryChange({ page: 1, country: value.trim() || undefined }),
      300
    )

  useEffect(() => {
    cancelSearchQuery()
    setSearch(query.query ?? '')
  }, [cancelSearchQuery, query.query])
  useEffect(() => {
    cancelCountryQuery()
    setCountry(query.country ?? '')
  }, [cancelCountryQuery, query.country])

  const pagination: PaginationState = {
    pageIndex: result.page - 1,
    pageSize: result.pageSize,
  }
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: result.items,
    columns,
    state: { pagination },
    manualPagination: true,
    pageCount: Math.max(result.totalPages, 1),
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater
      onQueryChange(
        next.pageSize === pagination.pageSize
          ? { page: next.pageIndex + 1 }
          : { page: 1, pageSize: next.pageSize }
      )
    },
    getCoreRowModel: getCoreRowModel(),
  })

  const reset = () => {
    cancelSearchQuery()
    cancelCountryQuery()
    setSearch('')
    setCountry('')
    onQueryChange({ page: 1, query: undefined, country: undefined })
  }

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='flex w-full flex-col items-start justify-between gap-2 lg:flex-row lg:items-center'>
        <div
          className='flex flex-1 flex-wrap items-center gap-2'
          role='group'
          aria-label='公司搜索条件'
        >
          <Input
            className='h-8 w-48 lg:w-72'
            aria-label='搜索公司'
            placeholder='名称、别名或外部 ID'
            value={search}
            onChange={(event) => {
              const value = event.target.value
              setSearch(value)
              runSearchQuery(value)
            }}
          />
          <Input
            className='h-8 w-28'
            aria-label='国家或地区代码'
            placeholder='国家代码'
            value={country}
            onChange={(event) => {
              const value = event.target.value
              setCountry(value)
              runCountryQuery(value)
            }}
          />
          {hasFilters ? (
            <Button size='sm' type='button' variant='ghost' onClick={reset}>
              <X className='size-4' />
              重置
            </Button>
          ) : null}
        </div>
        <div className='flex shrink-0 gap-2' role='group' aria-label='公司排序'>
          <Select
            value={query.sort}
            onValueChange={(sort: CatalogCompanyListQuery['sort']) =>
              onQueryChange({ page: 1, sort })
            }
          >
            <SelectTrigger className='h-8 w-36' aria-label='公司排序字段'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='patentCount'>相关专利</SelectItem>
              <SelectItem value='name'>公司名称</SelectItem>
              <SelectItem value='latestPatentDate'>最近授权</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={query.order}
            onValueChange={(order: CatalogCompanyListQuery['order']) =>
              onQueryChange({ page: 1, order })
            }
          >
            <SelectTrigger className='h-8 w-24' aria-label='公司排序方向'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='desc'>降序</SelectItem>
              <SelectItem value='asc'>升序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='overflow-hidden rounded-md border [&_[data-slot=table-container]]:overflow-x-hidden'>
        <Table className='table-fixed'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'overflow-hidden',
                      header.column.columnDef.meta?.className,
                      header.column.columnDef.meta?.thClassName
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'overflow-hidden',
                        cell.column.columnDef.meta?.className,
                        cell.column.columnDef.meta?.tdClassName
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  没有符合条件的公司。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} className='mt-auto' />
      <CatalogCompanyDetailDialog
        company={activeCompany}
        canGoBack={companyHistory.length > 1}
        onBack={() => setCompanyHistory((history) => history.slice(0, -1))}
        onOpenChange={(open) => {
          if (!open) setCompanyHistory([])
        }}
        onRelatedCompanyOpen={(company) =>
          setCompanyHistory((history) => [...history, company])
        }
        returnFocusRef={companyTriggerRef}
      />
    </div>
  )
}
