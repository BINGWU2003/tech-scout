import { useNavigate, useLocation } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { authApi } from '@/lib/auth-api'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { auth } = useAuthStore()

  const handleSignOut = async () => {
    try {
      await authApi.logout()
    } catch (error) {
      handleServerError(error)
      return
    }
    auth.reset()
    await navigate({
      to: '/sign-in',
      search: { redirect: location.href },
      replace: true,
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='退出登录'
      desc='确认退出当前设备吗？'
      confirmText='退出'
      destructive
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
