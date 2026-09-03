import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { type AuthenticatedRequest } from '../auth/auth.types.js'

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (request.auth.user.role !== 'admin') {
      throw new ForbiddenException({
        code: 'ADMIN_REQUIRED',
        message: '需要管理员权限',
      })
    }
    return true
  }
}
