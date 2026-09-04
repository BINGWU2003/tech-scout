import { Link } from '@tanstack/react-router'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table'
import {
  type CatalogPatentList,
  type CatalogPatentListQuery,
  type CatalogPatentSummary,
} from '@tech-scout/contracts'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { CatalogTableTooltip } from './catalog-table-tooltip'
import { YearRangePicker } from './year-range-picker'

const columns: ColumnDef<CatalogPatentSummary>[] = [
  {
    accessorKey: 'title',
    header: '专利',
    meta: { className: 'w-[34%] max-w-0' },
    cell: ({ row }) => (
      <div className='flex min-w-0 flex-col items-start'>
        <CatalogTableTooltip content={row.original.title}>
          <Link
            className='inline-block max-w-full truncate align-bottom font-medium text-primary hover:underline'
            to='/catalog/patents/$patentId'
            params={{ patentId: row.original.patentId }}
          >
            {row.original.title}
          </Link>
        </CatalogTableTooltip>
        <CatalogTableTooltip content={row.original.patentId}>
          <span
            className='mt-1 inline-block max-w-full truncate align-bottom text-xs text-muted-foreground'
            tabIndex={0}
          >
            {row.original.patentId}
          </span>
        </CatalogTableTooltip>
      </div>
    ),
  },
  {
    accessorKey: 'patentDate',
    header: '授权日期',
    meta: { className: 'w-[14%]' },
    cell: ({ row }) => row.original.patentDate,
  },
  {
    id: 'assignees',
    header: '受让人',
    meta: { className: 'w-[25%] max-w-0' },
    cell: ({ row }) => {
      const assignees = row.original.assignees.join('、') || '未知'

      return (
        <CatalogTableTooltip content={assignees}>
          <span
            className='inline-block max-w-full truncate align-bottom'
            tabIndex={0}
          >
            {assignees}
          </span>
        </CatalogTableTooltip>
      )
    },
  },
  {
    id: 'cpcGroups',
    header: 'CPC',
    meta: { className: 'w-[19%] max-w-0' },
    cell: ({ row }) => {
      const cpcGroups = row.original.cpcGroups
      const content = cpcGroups.join('、') || '未知'

      return (
        <CatalogTableTooltip content={content}>
          <span
            className='inline-grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 align-bottom'
            tabIndex={0}
          >
            {cpcGroups.length ? (
              <>
                <Badge variant='secondary' className='max-w-full min-w-0'>
                  <span className='truncate'>{cpcGroups[0]}</span>
                </Badge>
                {cpcGroups.length > 1 ? (
                  <Badge variant='outline'>+{cpcGroups.length - 1}</Badge>
                ) : null}
              </>
            ) : (
              <span>未知</span>
            )}
          </span>
        </CatalogTableTooltip>
      )
    },
  },
  {
    accessorKey: 'totalScore',
    header: '入域分',
    meta: { className: 'w-[8%]' },
    cell: ({ row }) => (
      <span className='tabular-nums'>{row.original.totalScore}</span>
    ),
  },
]

type CatalogPatentTableProps = {
  result: CatalogPatentList
  query: CatalogPatentListQuery
  onQueryChange: (patch: Partial<CatalogPatentListQuery>) => void
}

export function CatalogPatentTable({
  result,
  query,
  onQueryChange,
}: CatalogPatentTableProps) {
  const [title, setTitle] = useState(query.title ?? '')
  const [cpcPrefix, setCpcPrefix] = useState(query.cpcPrefix ?? '')
  const [partyName, setPartyName] = useState(query.partyName ?? '')
  const [fromYear, setFromYear] = useState(query.fromYear)
  const [toYear, setToYear] = useState(query.toYear)
  const hasFilters =
    title.trim() !== '' ||
    cpcPrefix.trim() !== '' ||
    partyName.trim() !== '' ||
    fromYear !== undefined ||
    toYear !== undefined
  const { cancel: cancelTitleQuery, run: runTitleQuery } = useDebouncedCallback(
    (value: string) =>
      onQueryChange({ page: 1, title: value.trim() || undefined }),
    300
  )
  const { cancel: cancelCpcQuery, run: runCpcQuery } = useDebouncedCallback(
    (value: string) =>
      onQueryChange({ page: 1, cpcPrefix: value.trim() || undefined }),
    300
  )
  const { cancel: cancelPartyQuery, run: runPartyQuery } = useDebouncedCallback(
    (value: string) =>
      onQueryChange({ page: 1, partyName: value.trim() || undefined }),
    300
  )

  useEffect(() => {
    cancelTitleQuery()
    setTitle(query.title ?? '')
  }, [cancelTitleQuery, query.title])
  useEffect(() => {
    cancelCpcQuery()
    setCpcPrefix(query.cpcPrefix ?? '')
  }, [cancelCpcQuery, query.cpcPrefix])
  useEffect(() => {
    cancelPartyQuery()
    setPartyName(query.partyName ?? '')
  }, [cancelPartyQuery, query.partyName])
  useEffect(() => setFromYear(query.fromYear), [query.fromYear])
  useEffect(() => setToYear(query.toYear), [query.toYear])

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
    cancelTitleQuery()
    cancelCpcQuery()
    cancelPartyQuery()
    setTitle('')
    setCpcPrefix('')
    setPartyName('')
    setFromYear(undefined)
    setToYear(undefined)
    onQueryChange({
      page: 1,
      title: undefined,
      cpcPrefix: undefined,
      partyName: undefined,
      fromYear: undefined,
      toYear: undefined,
    })
  }

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='flex w-full flex-col items-start justify-between gap-2 lg:flex-row lg:items-center'>
        <div
          className='flex flex-1 flex-wrap items-center gap-2'
          role='group'
          aria-label='专利搜索条件'
        >
          <Input
            className='h-8 w-56'
            aria-label='专利标题'
            placeholder='标题关键词'
            value={title}
            onChange={(event) => {
              const value = event.target.value
              setTitle(value)
              runTitleQuery(value)
            }}
          />
          <Input
            className='h-8 w-36'
            aria-label='CPC 前缀'
            placeholder='CPC 前缀'
            value={cpcPrefix}
            onChange={(event) => {
              const value = event.target.value
              setCpcPrefix(value)
              runCpcQuery(value)
            }}
          />
          <Input
            className='h-8 w-48'
            aria-label='受让人'
            placeholder='受让人'
            value={partyName}
            onChange={(event) => {
              const value = event.target.value
              setPartyName(value)
              runPartyQuery(value)
            }}
          />
          <YearRangePicker
            fromYear={fromYear}
            toYear={toYear}
            onChange={(range) => {
              setFromYear(range.fromYear)
              setToYear(range.toYear)
              onQueryChange({ page: 1, ...range })
            }}
          />
          {hasFilters ? (
            <Button size='sm' type='button' variant='ghost' onClick={reset}>
              <X className='size-4' />
              重置
            </Button>
          ) : null}
        </div>
        <div className='flex shrink-0 gap-2' role='group' aria-label='专利排序'>
          <Select
            value={query.sort}
            onValueChange={(sort: CatalogPatentListQuery['sort']) =>
              onQueryChange({ page: 1, sort })
            }
          >
            <SelectTrigger className='h-8 w-36' aria-label='专利排序字段'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='score'>入域分</SelectItem>
              <SelectItem value='patentDate'>授权日期</SelectItem>
              <SelectItem value='title'>标题</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={query.order}
            onValueChange={(order: CatalogPatentListQuery['order']) =>
              onQueryChange({ page: 1, order })
            }
          >
            <SelectTrigger className='h-8 w-24' aria-label='专利排序方向'>
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
                  没有符合条件的专利。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} className='mt-auto' />
    </div>
  )
}
