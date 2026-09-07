import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { IntelligenceClient } from './intelligence.client.js'
import { ResearchViewController } from './research-view.controller.js'
import { ResearchViewService } from './research-view.service.js'
import { ResearchController } from './research.controller.js'
import { ResearchService } from './research.service.js'

@Module({
  imports: [AuthModule],
  providers: [IntelligenceClient, ResearchService, ResearchViewService],
  controllers: [ResearchController, ResearchViewController],
})
export class ResearchModule {}
