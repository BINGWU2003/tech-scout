import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { CatalogPrismaService } from '../database/catalog-prisma.service.js'
import { LibraryController } from './library.controller.js'
import { LibraryRepository } from './library.repository.js'
@Module({
  imports: [AuthModule],
  controllers: [LibraryController],
  providers: [CatalogPrismaService, LibraryRepository],
})
export class LibraryModule {}
