import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { IntelligenceClient } from './intelligence.client.js'
import { ResearchController } from './research.controller.js'
import { ResearchService } from './research.service.js'

@Module({
  imports: [AuthModule],
  providers: [IntelligenceClient, ResearchService],
  controllers: [ResearchController],
})
export class ResearchModule {}
