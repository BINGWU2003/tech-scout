import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  type User,
  type UserRole,
  type UserStatus,
} from '@tech-scout/contracts'
import { KeyRound, LogOut, Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfigDrawer } from '@/components/config-drawer'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminApi } from '@/lib/auth-api'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

const route = getRouteApi('/_authenticated/users/')
type Action =
  | { kind: 'status'; user: User; value: UserStatus }
  | { kind: 'role'; user: User; value: UserRole }
  | { kind: 'sessions'; user: User }
  | { kind: 'reset'; user: User }

export function Users() {
  const search = route.useSearch()
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.auth.user)
  const [searchText, setSearchText] = useState(search.search)
  const [action, setAction] = useState<Action | null>(null)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null
  )
  const query = useQuery({
    queryKey: [
      'admin-users',
      page,
      pageSize,
      search.search,
      search.role,
      search.status,
    ],
    queryFn: () =>
      adminApi.users({
        page,
        pageSize,
        search: search.search || undefined,
        role: search.role,
        status: search.status,
      }),
  })
  const mutation = useMutation({
    mutationFn: async (next: Action) => {
      if (next.kind === 'status') {
        await adminApi.updateStatus(next.user.id, next.value)
      } else if (next.kind === 'role') {
        await adminApi.updateRole(next.user.id, next.value)
      } else if (next.kind === 'sessions') {
        await adminApi.revokeSessions(next.user.id)
      } else {
        const result = await adminApi.resetPassword(next.user.id)
        setGeneratedPassword(result.password)
      }
    },
    onSuccess: async () => {
      toast.success('操作成功')
      setAction(null)
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: handleServerError,
  })

  const applySearch = () =>
    navigate({
      search: (previous) => ({ ...previous, page: 1, search: searchText }),
    })

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>用户管理</h2>
          <p className='text-muted-foreground'>
            管理账号状态、角色、密码和登录会话。
          </p>
        </div>

        <div className='flex flex-wrap gap-2'>
          <Input
            className='max-w-sm'
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && applySearch()}
            placeholder='搜索用户名或邮箱'
          />
          <Button variant='outline' onClick={applySearch}>
            <Search /> 搜索
          </Button>
          <select
            className='rounded-md border bg-background px-3 text-sm'
            value={search.role ?? ''}
            onChange={(event) =>
              navigate({
                search: (previous) => ({
                  ...previous,
                  page: 1,
                  role: (event.target.value || undefined) as
                    | UserRole
                    | undefined,
                }),
              })
            }
          >
            <option value=''>全部角色</option>
            <option value='user'>普通用户</option>
            <option value='admin'>管理员</option>
          </select>
          <select
            className='rounded-md border bg-background px-3 text-sm'
            value={search.status ?? ''}
            onChange={(event) =>
              navigate({
                search: (previous) => ({
                  ...previous,
                  page: 1,
                  status: (event.target.value || undefined) as
                    | UserStatus
                    | undefined,
                }),
              })
            }
          >
            <option value=''>全部状态</option>
            <option value='active'>启用</option>
            <option value='disabled'>禁用</option>
          </select>
        </div>

        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>最后登录</TableHead>
                <TableHead className='text-end'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center'>
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {query.data?.items.map((user) => {
                const isSelf = user.id === currentUser?.id
                return (
                  <TableRow key={user.id}>
                    <TableCell className='font-medium'>
                      {user.username}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>
                        {user.role === 'admin' ? '管理员' : '用户'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.status === 'active' ? 'default' : 'secondary'
                        }
                      >
                        {user.status === 'active' ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : '从未'}
                    </TableCell>
                    <TableCell>
                      <div className='flex justify-end gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={isSelf}
                          onClick={() =>
                            setAction({
                              kind: 'role',
                              user,
                              value: user.role === 'admin' ? 'user' : 'admin',
                            })
                          }
                        >
                          {user.role === 'admin' ? '降为用户' : '设为管理员'}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={isSelf}
                          onClick={() =>
                            setAction({
                              kind: 'status',
                              user,
                              value:
                                user.status === 'active'
                                  ? 'disabled'
                                  : 'active',
                            })
                          }
                        >
                          {user.status === 'active' ? '禁用' : '恢复'}
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          disabled={isSelf}
                          title='重置密码'
                          onClick={() => setAction({ kind: 'reset', user })}
                        >
                          <KeyRound />
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          title='撤销全部会话'
                          onClick={() => setAction({ kind: 'sessions', user })}
                        >
                          <LogOut />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {query.data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center'>
                    没有符合条件的用户。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {query.data && (
          <div className='flex items-center justify-end gap-3'>
            <span className='text-sm text-muted-foreground'>
              第 {query.data.page} / {Math.max(query.data.totalPages, 1)} 页，共{' '}
              {query.data.total} 人
            </span>
            <Button
              variant='outline'
              disabled={page <= 1}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, page: (prev.page ?? 1) - 1 }),
                })
              }
            >
              上一页
            </Button>
            <Button
              variant='outline'
              disabled={page >= query.data.totalPages}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }),
                })
              }
            >
              下一页
            </Button>
          </div>
        )}
      </Main>

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
        title='确认账号操作'
        desc={action ? `确认对用户 ${action.user.username} 执行此操作吗？` : ''}
        confirmText='确认'
        destructive={action?.kind === 'status' && action.value === 'disabled'}
        isLoading={mutation.isPending}
        handleConfirm={() => action && mutation.mutate(action)}
      />

      <Dialog
        open={generatedPassword !== null}
        onOpenChange={() => setGeneratedPassword(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新密码已生成</DialogTitle>
            <DialogDescription>
              密码只展示这一次，请通过线下方式交给用户。
            </DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            value={generatedPassword ?? ''}
            onFocus={(event) => event.target.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
