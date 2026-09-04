import { Link } from '@tanstack/react-router'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table'
import {
  type CatalogCandidateDetailResponse,
  type CatalogEvidenceList,
} from '@tech-scout/contracts'
import { ExternalLink } from 'lucide-react'
import { DataTablePagination } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { CatalogTableTooltip } from './catalog-table-tooltip'

type CatalogEvidence = CatalogEvidenceList['items'][number]

const evidenceColumns: ColumnDef<CatalogEvidence>[] = [
  {
    accessorKey: 'publisher',
    header: '发布方',
    meta: { className: 'w-[15%] max-w-0' },
    cell: ({ row }) => (
      <div className='flex min-w-0 flex-col items-start'>
        <CatalogTableTooltip content={row.original.publisher}>
          <span
            className='inline-block max-w-full truncate align-bottom font-medium'
            tabIndex={0}
          >
            {row.original.publisher}
          </span>
        </CatalogTableTooltip>
        <CatalogTableTooltip content={row.original.sourceType}>
          <span
            className='inline-block max-w-full truncate align-bottom text-xs text-muted-foreground'
            tabIndex={0}
          >
            {row.original.sourceType}
          </span>
        </CatalogTableTooltip>
      </div>
    ),
  },
  {
    accessorKey: 'legalName',
    header: '主体信息',
    meta: { className: 'w-[32%] max-w-0' },
    cell: ({ row }) => {
      const legalName = row.original.legalName ?? '未提供法定名称'
      const identifier =
        [
          row.original.country,
          row.original.identifierType,
          row.original.identifierValue,
        ]
          .filter(Boolean)
          .join(' · ') || '无外部标识'

      return (
        <div className='flex min-w-0 flex-col items-start'>
          <CatalogTableTooltip content={legalName}>
            <span
              className='inline-block max-w-full truncate align-bottom'
              tabIndex={0}
            >
              {legalName}
            </span>
          </CatalogTableTooltip>
          <CatalogTableTooltip content={identifier}>
            <span
              className='inline-block max-w-full truncate align-bottom text-xs text-muted-foreground'
              tabIndex={0}
            >
              {identifier}
            </span>
          </CatalogTableTooltip>
        </div>
      )
    },
  },
  {
    accessorKey: 'observedAt',
    header: '采集时间',
    meta: { className: 'w-[20%] max-w-0' },
    cell: ({ row }) => {
      const observedAt = new Date(row.original.observedAt).toLocaleString(
        'zh-CN'
      )

      return (
        <CatalogTableTooltip content={observedAt}>
          <span
            className='inline-block max-w-full truncate align-bottom'
            tabIndex={0}
          >
            {observedAt}
          </span>
        </CatalogTableTooltip>
      )
    },
  },
  {
    accessorKey: 'preserved',
    header: '已留存',
    meta: { className: 'w-[8%]' },
    cell: ({ row }) => (row.original.preserved ? '是' : '否'),
  },
  {
    id: 'source',
    header: '来源',
    meta: { className: 'w-[25%] max-w-0' },
    cell: ({ row }) => {
      const sourceLocation = `${row.original.source.relativePath ?? row.original.source.dataset}:${row.original.source.sourceRowNumber}`

      return (
        <div className='flex min-w-0 flex-col items-start'>
          <a
            className='inline-flex items-center gap-1 font-medium text-primary hover:underline'
            href={row.original.sourceUrl}
            target='_blank'
            rel='noreferrer'
          >
            查看证据
            <ExternalLink className='size-3.5' />
          </a>
          <CatalogTableTooltip content={sourceLocation}>
            <span
              className='inline-block max-w-full truncate align-bottom font-mono text-xs text-muted-foreground'
              tabIndex={0}
            >
              {sourceLocation}
            </span>
          </CatalogTableTooltip>
        </div>
      )
    },
  },
]

export function CatalogCandidateDetail({
  candidate,
  evidence,
  onPageChange,
}: {
  candidate: CatalogCandidateDetailResponse['candidate']
  evidence: CatalogEvidenceList
  onPageChange: (page: number) => void
}) {
  const pagination: PaginationState = {
    pageIndex: evidence.page - 1,
    pageSize: evidence.pageSize,
  }
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: evidence.items,
    columns: evidenceColumns,
    state: { pagination },
    manualPagination: true,
    pageCount: Math.max(evidence.totalPages, 1),
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater
      onPageChange(next.pageIndex + 1)
    },
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className='grid gap-4 xl:grid-cols-3'>
      <Card>
        <CardHeader>
          <CardTitle>候选概览</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-2 gap-3 text-sm'>
            <div className='col-span-2'>
              <dt className='text-muted-foreground'>候选 ID</dt>
              <dd className='font-mono break-all'>{candidate.candidateId}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>国家/地区</dt>
              <dd>{candidate.country ?? '未知'}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>专利数</dt>
              <dd>{candidate.patentCount}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>参与方记录</dt>
              <dd>{candidate.partyRowCount}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>原始名称变体</dt>
              <dd>{candidate.rawNameVariantCount}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>审核决策</CardTitle>
        </CardHeader>
        <CardContent>
          {candidate.decision ? (
            <dl className='grid gap-3 text-sm'>
              <div className='flex flex-wrap gap-2'>
                <Badge>{candidate.decision.value}</Badge>
                <Badge variant='outline'>
                  {candidate.decision.organizationType}
                </Badge>
              </div>
              <div>
                <dt className='text-muted-foreground'>审核方式</dt>
                <dd>{candidate.decision.reviewMethod}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>说明</dt>
                <dd>{candidate.decision.note ?? '未提供'}</dd>
              </div>
            </dl>
          ) : (
            <p className='text-sm text-muted-foreground'>尚无终态审核决策。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>匹配建议</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {candidate.suggestions.length ? (
            candidate.suggestions.map((suggestion) => (
              <div
                key={suggestion.matchId}
                className='rounded-md border p-3 text-sm'
              >
                {suggestion.suggestedCompanyId && suggestion.suggestedName ? (
                  <Link
                    className='font-medium text-primary hover:underline'
                    to='/catalog/companies/$companyId'
                    params={{ companyId: suggestion.suggestedCompanyId }}
                  >
                    {suggestion.suggestedName}
                  </Link>
                ) : (
                  <div className='font-medium'>未关联公司</div>
                )}
                <div className='mt-1 text-xs text-muted-foreground'>
                  {suggestion.matchMethod}
                  {suggestion.similarityScore === null
                    ? ''
                    : ` · ${(suggestion.similarityScore * 100).toFixed(0)}%`}
                  {' · '}
                  {suggestion.decisionReason}
                </div>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>暂无匹配建议。</p>
          )}
        </CardContent>
      </Card>

      <Card className='xl:col-span-3'>
        <CardHeader>
          <CardTitle>支持证据</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
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
                      colSpan={evidenceColumns.length}
                      className='h-20 text-center'
                    >
                      暂无支持证据。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <DataTablePagination table={table} className='mt-auto' />
        </CardContent>
      </Card>
    </div>
  )
}
