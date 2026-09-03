import {
  authSessionSchema,
  resetPasswordResponseSchema,
  userListSchema,
  userSchema,
  type AuthSession,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordResponse,
  type User,
  type UserList,
  type UserListQuery,
  type UserRole,
  type UserStatus,
} from '@tech-scout/contracts'
import { z } from 'zod'
import { apiRequest } from './api-client'

export const authApi = {
  register: (input: RegisterInput): Promise<AuthSession> =>
    apiRequest('auth/register', authSessionSchema, {
      method: 'post',
      json: input,
    }),
  login: (input: LoginInput): Promise<AuthSession> =>
    apiRequest('auth/login', authSessionSchema, {
      method: 'post',
      json: input,
    }),
  me: (): Promise<AuthSession> => apiRequest('auth/me', authSessionSchema),
  logout: (): Promise<void> =>
    apiRequest('auth/logout', z.undefined(), { method: 'post' }),
  changePassword: (input: ChangePasswordInput): Promise<AuthSession> =>
    apiRequest('auth/password', authSessionSchema, {
      method: 'patch',
      json: input,
    }),
}

export const adminApi = {
  users: (query: UserListQuery): Promise<UserList> => {
    const searchParams = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
    })
    if (query.search) searchParams.set('search', query.search)
    if (query.role) searchParams.set('role', query.role)
    if (query.status) searchParams.set('status', query.status)
    return apiRequest(`admin/users?${searchParams}`, userListSchema)
  },
  updateRole: (id: string, role: UserRole): Promise<User> =>
    apiRequest(`admin/users/${id}/role`, userSchema, {
      method: 'patch',
      json: { role },
    }),
  updateStatus: (id: string, status: UserStatus): Promise<User> =>
    apiRequest(`admin/users/${id}/status`, userSchema, {
      method: 'patch',
      json: { status },
    }),
  resetPassword: (id: string): Promise<ResetPasswordResponse> =>
    apiRequest(
      `admin/users/${id}/reset-password`,
      resetPasswordResponseSchema,
      { method: 'post' }
    ),
  revokeSessions: (id: string): Promise<void> =>
    apiRequest(`admin/users/${id}/sessions`, z.undefined(), {
      method: 'delete',
    }),
}
