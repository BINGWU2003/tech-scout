import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  updateUserRoleSchema,
  updateUserStatusSchema,
  userListQuerySchema,
  type ResetPasswordResponse,
  type User,
  type UserList,
  type UserListQuery,
  type UserRole,
  type UserStatus,
} from '@tech-scout/contracts'
import { AuthGuard } from '../auth/auth.guard.js'
import { type AuthenticatedRequest } from '../auth/auth.types.js'
import { CsrfGuard } from '../auth/csrf.guard.js'
import { CurrentAuth } from '../auth/current-auth.decorator.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { AdminGuard } from './admin.guard.js'
import { AdminService } from './admin.service.js'

@Controller('admin/users')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery
  ): Promise<UserList> {
    return this.admin.list(query)
  }

  @Patch(':id/role')
  @UseGuards(CsrfGuard)
  updateRole(
    @CurrentAuth() current: AuthenticatedRequest['auth'],
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserRoleSchema)) input: { role: UserRole }
  ): Promise<User> {
    return this.admin.updateRole(current.user.id, id, input.role)
  }

  @Patch(':id/status')
  @UseGuards(CsrfGuard)
  updateStatus(
    @CurrentAuth() current: AuthenticatedRequest['auth'],
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserStatusSchema)) input: {
      status: UserStatus
    }
  ): Promise<User> {
    return this.admin.updateStatus(current.user.id, id, input.status)
  }

  @Post(':id/reset-password')
  @UseGuards(CsrfGuard)
  resetPassword(
    @CurrentAuth() current: AuthenticatedRequest['auth'],
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ResetPasswordResponse> {
    return this.admin.resetPassword(current.user.id, id)
  }

  @Delete(':id/sessions')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  revokeSessions(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.admin.revokeSessions(id)
  }
}
