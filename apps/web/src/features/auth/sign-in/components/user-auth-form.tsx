import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { loginSchema } from '@tech-scout/contracts'
import { Loader2, LogIn } from 'lucide-react'
import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { authApi } from '@/lib/auth-api'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  })

  async function onSubmit(data: z.infer<typeof loginSchema>) {
    setIsLoading(true)
    try {
      const session = await authApi.login(data)
      auth.setSession(session)
      toast.success(`欢迎回来，${session.user.username}`)
      await navigate({
        to: redirectTo?.startsWith('/') ? redirectTo : '/',
        replace: true,
      })
    } catch (error) {
      handleServerError(error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='identifier'
          render={({ field }) => (
            <FormItem>
              <FormLabel>用户名或邮箱</FormLabel>
              <FormControl>
                <Input
                  placeholder='username 或 name@example.com'
                  autoComplete='username'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>密码</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='********'
                  autoComplete='current-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          登录
        </Button>
      </form>
    </Form>
  )
}
