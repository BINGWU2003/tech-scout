import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { type AuthenticatedRequest } from './auth.types.js'

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = request.header('x-csrf-token')
    this.auth.verifyCsrf(request.auth.session, token)
    return true
  }
}
