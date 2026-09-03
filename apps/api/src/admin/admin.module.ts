import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { AdminController } from './admin.controller.js'
import { AdminGuard } from './admin.guard.js'
import { AdminService } from './admin.service.js'

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
