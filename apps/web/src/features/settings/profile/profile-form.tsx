import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'

export function ProfileForm() {
  const user = useAuthStore((state) => state.auth.user)
  if (!user) return null
  return (
    <div className='max-w-lg space-y-5'>
      <div className='space-y-2'>
        <label className='text-sm font-medium'>用户名</label>
        <Input readOnly value={user.username} />
        <p className='text-sm text-muted-foreground'>用户名注册后不可修改。</p>
      </div>
      <div className='space-y-2'>
        <label className='text-sm font-medium'>邮箱</label>
        <Input readOnly value={user.email} />
        <p className='text-sm text-muted-foreground'>
          邮箱用于登录，不进行邮箱验证。
        </p>
      </div>
      <div className='flex gap-2'>
        <Badge variant='outline'>
          {user.role === 'admin' ? '管理员' : '普通用户'}
        </Badge>
        <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
          {user.status === 'active' ? '启用' : '禁用'}
        </Badge>
      </div>
    </div>
  )
}
