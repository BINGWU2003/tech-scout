import { zodResolver } from '@hookform/resolvers/zod'
import { passwordSchema } from '@tech-scout/contracts'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { authApi } from '@/lib/auth-api'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

const schema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的新密码不一致',
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: '新密码不能与当前密码相同',
  })

export function AccountForm() {
  const setSession = useAuthStore((state) => state.auth.setSession)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(value: z.infer<typeof schema>) {
    try {
      setSession(
        await authApi.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        })
      )
      form.reset()
      toast.success('密码已修改，其他设备的登录已撤销')
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className='max-w-lg space-y-5'
      >
        <FormField
          control={form.control}
          name='currentPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>当前密码</FormLabel>
              <FormControl>
                <PasswordInput autoComplete='current-password' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='newPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>新密码</FormLabel>
              <FormControl>
                <PasswordInput autoComplete='new-password' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>确认新密码</FormLabel>
              <FormControl>
                <PasswordInput autoComplete='new-password' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' disabled={form.formState.isSubmitting}>
          修改密码
        </Button>
      </form>
    </Form>
  )
}
