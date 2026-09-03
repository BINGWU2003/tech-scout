import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type AuthSession,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@tech-scout/contracts'
import { type Response } from 'express'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService, SESSION_COOKIE } from './auth.service.js'
import { type AuthenticatedRequest } from './auth.types.js'
import { CsrfGuard } from './csrf.guard.js'
import { CurrentAuth } from './current-auth.decorator.js'

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.SESSION_COOKIE_SECURE === 'true',
  sameSite: 'lax' as const,
  path: '/api/v1',
  maxAge: 30 * 24 * 60 * 60 * 1000,
})

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthSession> {
    const result = await this.auth.register(input)
    response.cookie(SESSION_COOKIE, result.token, cookieOptions())
    return result.response
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthSession> {
    const result = await this.auth.login(input)
    response.cookie(SESSION_COOKIE, result.token, cookieOptions())
    return result.response
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(
    @CurrentAuth() current: AuthenticatedRequest['auth']
  ): Promise<AuthSession> {
    return this.auth.refresh(current.user, current.session)
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard, CsrfGuard)
  async logout(
    @CurrentAuth() current: AuthenticatedRequest['auth'],
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    await this.auth.logout(current.session.id)
    response.clearCookie(SESSION_COOKIE, cookieOptions())
  }

  @Patch('password')
  @UseGuards(AuthGuard, CsrfGuard)
  changePassword(
    @CurrentAuth() current: AuthenticatedRequest['auth'],
    @Body(new ZodValidationPipe(changePasswordSchema))
    input: ChangePasswordInput
  ): Promise<AuthSession> {
    return this.auth.changePassword(current.user, current.session, input)
  }
}
