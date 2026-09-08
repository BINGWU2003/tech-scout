import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { libraryQuerySchema, type LibraryQuery } from '@tech-scout/contracts'
import { AuthGuard } from '../auth/auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { LibraryRepository } from './library.repository.js'

@Controller('library')
@UseGuards(AuthGuard)
export class LibraryController {
  constructor(private readonly library: LibraryRepository) {}
  @Get('runs') runs() {
    return this.library.runs()
  }
  @Get('patents') patents(
    @Query(new ZodValidationPipe(libraryQuerySchema)) q: LibraryQuery
  ) {
    return this.library.list('patent', q)
  }
  @Get('companies') companies(
    @Query(new ZodValidationPipe(libraryQuerySchema)) q: LibraryQuery
  ) {
    return this.library.list('company', q)
  }
  @Get('patents/:id') patent(@Param('id') id: string) {
    return this.library.detail('patent', id)
  }
  @Get('companies/:id') company(@Param('id') id: string) {
    return this.library.detail('company', id)
  }
}
