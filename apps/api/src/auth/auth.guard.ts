import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { type Request } from 'express'
import { AuthService, SESSION_COOKIE } from './auth.service.js'
import { type AuthenticatedRequest } from './auth.types.js'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined
    ;(request as AuthenticatedRequest).auth =
      await this.auth.authenticate(token)
    return true
  }
}
