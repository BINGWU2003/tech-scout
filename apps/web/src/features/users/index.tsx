import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { type User } from '@tech-scout/contracts'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfigDrawer } from '@/components/config-drawer'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { adminApi } from '@/lib/auth-api'
import { handleServerError } from '@/lib/handle-server-error'
import { type UserAction, UsersTable } from './components/users-table'

const route = getRouteApi('/_authenticated/users/')
const EMPTY_USERS: User[] = []

export function Users() {
  const search = route.useSearch()
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20
  const queryClient = useQueryClient()
  const [action, setAction] = useState<UserAction | null>(null)
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
    mutationFn: async (next: UserAction) => {
      if (next.kind === 'status') {
        await adminApi.updateStatus(next.user.id, next.value)
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
            <h2 className='text-2xl font-bold tracking-tight'>用户管理</h2>
            <p className='text-muted-foreground'>
              管理账号状态、角色、密码和登录会话。
            </p>
          </div>
        </div>
        <UsersTable
          data={query.data?.items ?? EMPTY_USERS}
          pageCount={query.data?.totalPages ?? 0}
          isLoading={query.isLoading}
          onAction={setAction}
        />
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
