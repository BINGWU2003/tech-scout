import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService } from './auth.service.js'
import { CsrfGuard } from './csrf.guard.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, CsrfGuard],
  exports: [AuthService, AuthGuard, CsrfGuard],
})
export class AuthModule {}
