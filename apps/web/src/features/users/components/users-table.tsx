import { Cross2Icon, DotsHorizontalIcon } from '@radix-ui/react-icons'
import { getRouteApi } from '@tanstack/react-router'
import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  type User,
  type UserRole,
  type UserStatus,
} from '@tech-scout/contracts'
import { CircleCheck, CircleOff, KeyRound, LogOut, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
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
  DropdownMenuSeparator,
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
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

const route = getRouteApi('/_authenticated/users/')

export type UserAction =
  | { kind: 'status'; user: User; value: UserStatus }
  | { kind: 'sessions'; user: User }
  | { kind: 'reset'; user: User }

type UsersTableProps = {
  data: User[]
  pageCount: number
  isLoading: boolean
  onAction: (action: UserAction) => void
}

type UsersRowActionsProps = {
  user: User
  isSelf: boolean
  onAction: (action: UserAction) => void
}

function UsersRowActions({ user, isSelf, onAction }: UsersRowActionsProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='flex size-8 p-0 data-[state=open]:bg-muted'
        >
          <DotsHorizontalIcon className='size-4' />
          <span className='sr-only'>打开用户操作菜单</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuItem
          disabled={isSelf}
          onClick={() =>
            onAction({
              kind: 'status',
              user,
              value: user.status === 'active' ? 'disabled' : 'active',
            })
          }
        >
          {user.status === 'active' ? '禁用账号' : '恢复账号'}
          <DropdownMenuShortcut>
            {user.status === 'active' ? (
              <CircleOff className='size-4' />
            ) : (
              <CircleCheck className='size-4' />
            )}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSelf}
          onClick={() => onAction({ kind: 'reset', user })}
        >
          重置密码
          <DropdownMenuShortcut>
            <KeyRound className='size-4' />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onAction({ kind: 'sessions', user })}>
          撤销全部会话
          <DropdownMenuShortcut>
            <LogOut className='size-4' />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function createUsersColumns(
  currentUserId: string | undefined,
  onAction: (action: UserAction) => void
): ColumnDef<User>[] {
  return [
    {
      accessorKey: 'username',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='用户名' />
      ),
      cell: ({ row }) => (
        <span className='font-medium'>{row.original.username}</span>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'email',
      meta: { label: '邮箱' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='邮箱' />
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'role',
      meta: { label: '角色' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='角色' />
      ),
      cell: ({ row }) => (
        <Badge variant='outline'>
          {row.original.role === 'admin' ? '管理员' : '普通用户'}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'status',
      meta: { label: '状态' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === 'active' ? 'default' : 'secondary'}
        >
          {row.original.status === 'active' ? '启用' : '禁用'}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      meta: { label: '创建时间' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建时间' />
      ),
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      enableSorting: false,
    },
    {
      accessorKey: 'lastLoginAt',
      meta: { label: '最后登录' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='最后登录' />
      ),
      cell: ({ row }) =>
        row.original.lastLoginAt
          ? new Date(row.original.lastLoginAt).toLocaleString()
          : '从未',
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <UsersRowActions
          user={row.original}
          isSelf={row.original.id === currentUserId}
          onAction={onAction}
        />
      ),
      enableHiding: false,
    },
  ]
}

export function UsersTable({
  data,
  pageCount,
  isLoading,
  onAction,
}: UsersTableProps) {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const currentUserId = useAuthStore((state) => state.auth.user?.id)
  const [searchText, setSearchText] = useState(search.search ?? '')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const columns = useMemo(
    () => createUsersColumns(currentUserId, onAction),
    [currentUserId, onAction]
  )
  const { pagination, onPaginationChange } = useTableUrlState({
    search,
    navigate,
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: false },
  })

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { columnVisibility, pagination },
    manualPagination: true,
    pageCount: Math.max(pageCount, 1),
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange,
    getCoreRowModel: getCoreRowModel(),
  })

  const applySearch = () =>
    navigate({
      search: (previous) => ({
        ...previous,
        page: undefined,
        search: searchText.trim() || undefined,
      }),
    })
  const isFiltered = Boolean(
    searchText.trim() || search.search || search.role || search.status
  )

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-1 flex-col-reverse items-start gap-2 sm:flex-row sm:items-center'>
          <Input
            className='h-8 w-48 lg:w-72'
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && applySearch()}
            placeholder='搜索用户名或邮箱'
          />
          <Button size='sm' onClick={applySearch}>
            <Search className='size-4' />
            搜索
          </Button>
          <div className='flex gap-2'>
            <Select
              value={search.role ?? 'all'}
              onValueChange={(value) =>
                navigate({
                  search: (previous) => ({
                    ...previous,
                    page: undefined,
                    role: value === 'all' ? undefined : (value as UserRole),
                  }),
                })
              }
            >
              <SelectTrigger className='h-8 w-32' aria-label='筛选角色'>
                <SelectValue placeholder='全部角色' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部角色</SelectItem>
                <SelectItem value='user'>普通用户</SelectItem>
                <SelectItem value='admin'>管理员</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={search.status ?? 'all'}
              onValueChange={(value) =>
                navigate({
                  search: (previous) => ({
                    ...previous,
                    page: undefined,
                    status: value === 'all' ? undefined : (value as UserStatus),
                  }),
                })
              }
            >
              <SelectTrigger className='h-8 w-32' aria-label='筛选状态'>
                <SelectValue placeholder='全部状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='active'>启用</SelectItem>
                <SelectItem value='disabled'>禁用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isFiltered ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                setSearchText('')
                navigate({
                  search: (previous) => ({
                    ...previous,
                    page: undefined,
                    search: undefined,
                    role: undefined,
                    status: undefined,
                  }),
                })
              }}
            >
              重置
              <Cross2Icon className='ms-2 size-4' />
            </Button>
          ) : null}
        </div>
        <DataTableViewOptions table={table} />
      </div>

      <div className='overflow-hidden rounded-md border'>
        <Table className='min-w-4xl'>
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
                  没有符合条件的用户。
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
