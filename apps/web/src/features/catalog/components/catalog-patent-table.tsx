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
import { Search, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
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

const columns: ColumnDef<CatalogPatentSummary>[] = [
  {
    accessorKey: 'title',
    header: '专利',
    cell: ({ row }) => (
      <div className='min-w-64'>
        <a
          className='font-medium text-primary hover:underline'
          href={`/catalog/patents/${encodeURIComponent(row.original.patentId)}`}
        >
          {row.original.title}
        </a>
        <div className='mt-1 text-xs text-muted-foreground'>
          {row.original.patentId}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'patentDate',
    header: '授权日期',
    cell: ({ row }) => row.original.patentDate,
  },
  {
    id: 'assignees',
    header: '受让人',
    cell: ({ row }) => row.original.assignees.join('、') || '未知',
  },
  {
    id: 'cpcGroups',
    header: 'CPC',
    cell: ({ row }) => (
      <div className='flex max-w-72 flex-wrap gap-1'>
        {row.original.cpcGroups.slice(0, 3).map((cpc) => (
          <Badge key={cpc} variant='secondary'>
            {cpc}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    accessorKey: 'totalScore',
    header: '入域分',
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
  const [fromYear, setFromYear] = useState(query.fromYear?.toString() ?? '')
  const [toYear, setToYear] = useState(query.toYear?.toString() ?? '')

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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onQueryChange({
      page: 1,
      title: title.trim() || undefined,
      cpcPrefix: cpcPrefix.trim() || undefined,
      partyName: partyName.trim() || undefined,
      fromYear: fromYear ? Number(fromYear) : undefined,
      toYear: toYear ? Number(toYear) : undefined,
    })
  }

  const reset = () => {
    setTitle('')
    setCpcPrefix('')
    setPartyName('')
    setFromYear('')
    setToYear('')
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
      <form className='flex flex-wrap items-center gap-2' onSubmit={submit}>
        <Input
          className='h-9 w-56'
          aria-label='专利标题'
          placeholder='标题关键词'
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          className='h-9 w-36'
          aria-label='CPC 前缀'
          placeholder='CPC 前缀'
          value={cpcPrefix}
          onChange={(event) => setCpcPrefix(event.target.value)}
        />
        <Input
          className='h-9 w-48'
          aria-label='受让人'
          placeholder='受让人'
          value={partyName}
          onChange={(event) => setPartyName(event.target.value)}
        />
        <Input
          className='h-9 w-28'
          aria-label='起始年份'
          placeholder='起始年份'
          type='number'
          min={1800}
          max={2100}
          value={fromYear}
          onChange={(event) => setFromYear(event.target.value)}
        />
        <Input
          className='h-9 w-28'
          aria-label='结束年份'
          placeholder='结束年份'
          type='number'
          min={1800}
          max={2100}
          value={toYear}
          onChange={(event) => setToYear(event.target.value)}
        />
        <Button size='sm' type='submit'>
          <Search className='size-4' />
          筛选
        </Button>
        <Button size='sm' type='button' variant='ghost' onClick={reset}>
          <X className='size-4' />
          重置
        </Button>
        <div className='ms-auto flex gap-2'>
          <Select
            value={query.sort}
            onValueChange={(sort: CatalogPatentListQuery['sort']) =>
              onQueryChange({ page: 1, sort })
            }
          >
            <SelectTrigger className='h-9 w-36' aria-label='专利排序字段'>
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
            <SelectTrigger className='h-9 w-24' aria-label='专利排序方向'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='desc'>降序</SelectItem>
              <SelectItem value='asc'>升序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </form>

      <div className='overflow-hidden rounded-md border'>
        <Table className='min-w-5xl'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
                    <TableCell key={cell.id}>
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
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <span className='text-sm text-muted-foreground'>
          共 {result.total.toLocaleString()} 件专利
        </span>
        <DataTablePagination table={table} />
      </div>
    </div>
  )
}
