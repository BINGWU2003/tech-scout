import { z } from 'zod'

export const userRoleSchema = z.enum(['user', 'admin'])
export const userStatusSchema = z.enum(['active', 'disabled'])

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, '用户名至少需要 3 个字符')
  .max(32, '用户名最多允许 32 个字符')
  .regex(/^[a-z0-9_-]+$/, '用户名只能包含小写字母、数字、下划线和短横线')

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email('请输入有效的邮箱地址'))

export const passwordSchema = z
  .string()
  .min(10, '密码至少需要 10 个字符')
  .max(128, '密码最多允许 128 个字符')

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, '请输入用户名或邮箱').max(254),
  password: z.string().min(1, '请输入密码').max(128),
})

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: '新密码不能与当前密码相同',
    path: ['newPassword'],
  })

export const userSchema = z.object({
  id: z.uuid(),
  username: usernameSchema,
  email: emailSchema,
  role: userRoleSchema,
  status: userStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
})

export const authSessionSchema = z.object({
  user: userSchema,
  csrfToken: z.string().min(32),
})

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
})

export const userListSchema = z.object({
  items: z.array(userSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export const updateUserRoleSchema = z.object({ role: userRoleSchema })
export const updateUserStatusSchema = z.object({ status: userStatusSchema })

export const resetPasswordResponseSchema = z.object({
  password: z.string().min(10),
})

export type AuthSession = z.infer<typeof authSessionSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>
export type User = z.infer<typeof userSchema>
export type UserList = z.infer<typeof userListSchema>
export type UserListQuery = z.infer<typeof userListQuerySchema>
export type UserRole = z.infer<typeof userRoleSchema>
export type UserStatus = z.infer<typeof userStatusSchema>
