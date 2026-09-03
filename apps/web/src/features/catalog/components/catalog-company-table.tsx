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

const columns: ColumnDef<CatalogCompanySummary>[] = [
  {
    accessorKey: 'preferredName',
    header: '公司',
    cell: ({ row }) => (
      <div className='min-w-56'>
        <a
          className='font-medium text-primary hover:underline'
          href={`/catalog/companies/${encodeURIComponent(row.original.companyId)}`}
        >
          {row.original.preferredName}
        </a>
        <div className='mt-1 text-xs text-muted-foreground'>
          {row.original.legalName ?? row.original.companyId}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'country',
    header: '国家/地区',
    cell: ({ row }) => row.original.country ?? '未知',
  },
  {
    accessorKey: 'provider',
    header: '身份来源',
    cell: ({ row }) => <Badge variant='outline'>{row.original.provider}</Badge>,
  },
  {
    accessorKey: 'patentCount',
    header: '相关专利',
    cell: ({ row }) => (
      <span className='tabular-nums'>{row.original.patentCount}</span>
    ),
  },
  {
    accessorKey: 'latestPatentDate',
    header: '最近授权',
    cell: ({ row }) => row.original.latestPatentDate ?? '未知',
  },
  {
    accessorKey: 'entityStatus',
    header: '主体状态',
    cell: ({ row }) => row.original.entityStatus ?? '未知',
  },
]

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
      query: search.trim() || undefined,
      country: country.trim() || undefined,
    })
  }
  const reset = () => {
    setSearch('')
    setCountry('')
    onQueryChange({ page: 1, query: undefined, country: undefined })
  }

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <form className='flex flex-wrap items-center gap-2' onSubmit={submit}>
        <Input
          className='h-9 w-64'
          aria-label='搜索公司'
          placeholder='名称、别名或外部 ID'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Input
          className='h-9 w-28'
          aria-label='国家或地区代码'
          placeholder='国家代码'
          value={country}
          onChange={(event) => setCountry(event.target.value)}
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
            onValueChange={(sort: CatalogCompanyListQuery['sort']) =>
              onQueryChange({ page: 1, sort })
            }
          >
            <SelectTrigger className='h-9 w-36' aria-label='公司排序字段'>
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
            <SelectTrigger className='h-9 w-24' aria-label='公司排序方向'>
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
        <Table className='min-w-4xl'>
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
                  没有符合条件的公司。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <span className='text-sm text-muted-foreground'>
          共 {result.total.toLocaleString()} 家已确认公司
        </span>
        <DataTablePagination table={table} />
      </div>
    </div>
  )
}
