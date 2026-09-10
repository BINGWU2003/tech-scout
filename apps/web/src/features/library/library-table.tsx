import { Cross2Icon, DotsHorizontalIcon } from '@radix-ui/react-icons'
import {
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { type LibraryRecord } from '@tech-scout/contracts'
import { Eye } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  DataTableColumnHeader,
  DataTablePagination,
} from '@/components/data-table'
import { DataTableViewOptions } from '@/components/data-table/view-options'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { type LibraryKind } from './library-navigation'

const statusLabels: Record<string, string> = {
  completed: '采集完成',
  running: '采集中',
  queued: '等待采集',
  paused: '已暂停',
  waiting: '等待登录或验证',
  failed: '采集失败',
}

export type LibraryRun = {
  runId: string
  status: string
  directions: string[]
}

type LibraryTableProps = {
  kind: LibraryKind
  data: LibraryRecord[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  query: string
  runId: string
  runs: LibraryRun[]
  isLoading: boolean
  runsLoading: boolean
  onQueryChange: (value: string) => void
  onRunIdChange: (value: string) => void
  onReset: () => void
  onPaginationChange: OnChangeFn<PaginationState>
  onOpenDetail: (id: string) => void
}

function LibraryRowActions({
  record,
  onOpenDetail,
}: {
  record: LibraryRecord
  onOpenDetail: (id: string) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='flex size-8 p-0 data-[state=open]:bg-muted'
        >
          <DotsHorizontalIcon className='size-4' />
          <span className='sr-only'>打开记录操作菜单</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-36'>
        <DropdownMenuItem onClick={() => onOpenDetail(record.id)}>
          查看详情
          <DropdownMenuShortcut>
            <Eye className='size-4' />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function createLibraryColumns(
  kind: LibraryKind,
  onOpenDetail: (id: string) => void
): ColumnDef<LibraryRecord>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='名称' />
      ),
      cell: ({ row }) => (
        <div>
          <button
            type='button'
            className='text-left font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2'
            onClick={() => onOpenDetail(row.original.id)}
          >
            {row.original.name}
          </button>
          {kind === 'patents' ? (
            <p className='mt-1 text-xs text-muted-foreground'>
              {row.original.id}
            </p>
          ) : null}
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'identifier',
      accessorFn: (row) => row.creditCode ?? row.date ?? '未提供',
      meta: {
        label: kind === 'companies' ? '统一社会信用代码' : '公开日期',
      },
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={kind === 'companies' ? '统一社会信用代码' : '公开日期'}
        />
      ),
      cell: ({ row }) =>
        row.original.creditCode ?? row.original.date ?? '未提供',
      enableSorting: false,
    },
    {
      id: 'status',
      accessorFn: (row) => row.sources.map((source) => source.status).join(','),
      meta: { label: '采集状态' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='采集状态' />
      ),
      cell: ({ row }) => {
        const statuses = [
          ...new Set(
            row.original.sources.map(
              (source) => statusLabels[source.status] ?? source.status
            )
          ),
        ]
        return (
          <div className='space-y-1'>
            <div className='flex flex-wrap gap-1'>
              {statuses.map((status) => (
                <Badge key={status} variant='outline'>
                  {status}
                </Badge>
              ))}
            </div>
            <p className='text-xs text-muted-foreground'>
              {row.original.sources.length} 次研究
            </p>
          </div>
        )
      },
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <LibraryRowActions record={row.original} onOpenDetail={onOpenDetail} />
      ),
      enableHiding: false,
    },
  ]
}

export function LibraryTable({
  kind,
  data,
  total,
  page,
  pageSize,
  pageCount,
  query,
  runId,
  runs,
  isLoading,
  runsLoading,
  onQueryChange,
  onRunIdChange,
  onReset,
  onPaginationChange,
  onOpenDetail,
}: LibraryTableProps) {
  const [searchText, setSearchText] = useState(query)
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const { cancel: cancelSearchQuery, run: runSearchQuery } =
    useDebouncedCallback(onQueryChange, 300)
  const columns = useMemo(
    () => createLibraryColumns(kind, onOpenDetail),
    [kind, onOpenDetail]
  )

  useEffect(() => {
    cancelSearchQuery()
    setSearchText(query)
  }, [cancelSearchQuery, query])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: {
      columnVisibility,
      pagination: { pageIndex: page - 1, pageSize },
    },
    manualPagination: true,
    pageCount: Math.max(pageCount, 1),
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange,
    getCoreRowModel: getCoreRowModel(),
  })
  const isFiltered = Boolean(searchText.trim() || query || runId)
  const entityName = kind === 'companies' ? '企业' : '专利'

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-1 flex-col-reverse items-start gap-2 sm:flex-row sm:items-center'>
          <Input
            aria-label='检索名称或编号'
            className='h-8 w-48 lg:w-72'
            value={searchText}
            onChange={(event) => {
              const value = event.target.value
              setSearchText(value)
              runSearchQuery(value)
            }}
            placeholder={
              kind === 'companies'
                ? '搜索企业名称或编号'
                : '搜索专利名称或公开号'
            }
          />
          <Select
            value={runId || 'all'}
            disabled={runsLoading}
            onValueChange={(value) =>
              onRunIdChange(value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className='h-8 w-52' aria-label='按研究来源筛选'>
              <SelectValue
                placeholder={runsLoading ? '加载研究来源…' : '全部研究来源'}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>全部研究来源</SelectItem>
              {runs.map((run) => (
                <SelectItem key={run.runId} value={run.runId}>
                  {run.directions.join('、')} · {run.runId.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFiltered ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                cancelSearchQuery()
                setSearchText('')
                onReset()
              }}
            >
              重置
              <Cross2Icon className='ms-2 size-4' />
            </Button>
          ) : null}
        </div>
        <DataTableViewOptions table={table} />
      </div>

      <p className='text-sm text-muted-foreground'>共 {total} 条记录</p>

      <div className='overflow-hidden rounded-md border'>
        <Table className='min-w-3xl'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(
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
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className='h-24 text-center'
                >
                  加载中…
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
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
                  colSpan={table.getVisibleLeafColumns().length}
                  className='h-24 text-center'
                >
                  {isFiltered
                    ? `没有符合条件的${entityName}。`
                    : `暂无已入库的${entityName}。`}
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
