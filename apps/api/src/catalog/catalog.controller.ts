import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import {
  catalogPatentListQuerySchema,
  catalogCompanyListQuerySchema,
  catalogCompanyPatentListQuerySchema,
  catalogPageQuerySchema,
  entityIdSchema,
  type CatalogDomainList,
  type CatalogDomainDetailResponse,
  type CatalogCompanyList,
  type CatalogCompanyListQuery,
  type CatalogCompanyDetailResponse,
  type CatalogCompanyPatentListQuery,
  type CatalogCandidateDetailResponse,
  type CatalogEvidenceList,
  type CatalogPageQuery,
  type CatalogSourceResponse,
  type CatalogPatentList,
  type CatalogPatentListQuery,
  type CatalogPatentDetailResponse,
  type CatalogRelease,
} from '@tech-scout/contracts'
import { AuthGuard } from '../auth/auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { CatalogAvailabilityInterceptor } from './catalog-availability.interceptor.js'
import { CatalogRepository } from './catalog.repository.js'

@Controller('catalog')
@UseGuards(AuthGuard)
@UseInterceptors(CatalogAvailabilityInterceptor)
export class CatalogController {
  constructor(private readonly catalog: CatalogRepository) {}

  @Get('releases/current')
  currentRelease(): Promise<CatalogRelease> {
    return this.catalog.currentRelease()
  }

  @Get('domains')
  listDomains(): Promise<CatalogDomainList> {
    return this.catalog.listDomains()
  }

  @Get('domains/:domainId')
  domainDetail(
    @Param('domainId', new ZodValidationPipe(entityIdSchema)) domainId: string
  ): Promise<CatalogDomainDetailResponse> {
    return this.catalog.domainDetail(domainId)
  }

  @Get('domains/:domainId/patents')
  listDomainPatents(
    @Param('domainId', new ZodValidationPipe(entityIdSchema)) domainId: string,
    @Query(new ZodValidationPipe(catalogPatentListQuerySchema))
    query: CatalogPatentListQuery
  ): Promise<CatalogPatentList> {
    return this.catalog.listDomainPatents(domainId, query)
  }

  @Get('patents/:patentId')
  patentDetail(
    @Param('patentId', new ZodValidationPipe(entityIdSchema)) patentId: string
  ): Promise<CatalogPatentDetailResponse> {
    return this.catalog.patentDetail(patentId)
  }

  @Get('domains/:domainId/companies')
  listDomainCompanies(
    @Param('domainId', new ZodValidationPipe(entityIdSchema)) domainId: string,
    @Query(new ZodValidationPipe(catalogCompanyListQuerySchema))
    query: CatalogCompanyListQuery
  ): Promise<CatalogCompanyList> {
    return this.catalog.listDomainCompanies(domainId, query)
  }

  @Get('companies')
  listCompanies(
    @Query(new ZodValidationPipe(catalogCompanyListQuerySchema))
    query: CatalogCompanyListQuery
  ): Promise<CatalogCompanyList> {
    return this.catalog.listCompanies(query)
  }

  @Get('companies/:companyId')
  companyDetail(
    @Param('companyId', new ZodValidationPipe(entityIdSchema)) companyId: string
  ): Promise<CatalogCompanyDetailResponse> {
    return this.catalog.companyDetail(companyId)
  }

  @Get('companies/:companyId/patents')
  listCompanyPatents(
    @Param('companyId', new ZodValidationPipe(entityIdSchema))
    companyId: string,
    @Query(new ZodValidationPipe(catalogCompanyPatentListQuerySchema))
    query: CatalogCompanyPatentListQuery
  ): Promise<CatalogPatentList> {
    return this.catalog.listCompanyPatents(companyId, query)
  }

  @Get('candidates/:candidateId')
  candidateDetail(
    @Param('candidateId', new ZodValidationPipe(entityIdSchema))
    candidateId: string
  ): Promise<CatalogCandidateDetailResponse> {
    return this.catalog.candidateDetail(candidateId)
  }

  @Get('candidates/:candidateId/evidence')
  candidateEvidence(
    @Param('candidateId', new ZodValidationPipe(entityIdSchema))
    candidateId: string,
    @Query(new ZodValidationPipe(catalogPageQuerySchema))
    query: CatalogPageQuery
  ): Promise<CatalogEvidenceList> {
    return this.catalog.candidateEvidence(candidateId, query)
  }

  @Get('sources/:locator')
  sourceDetail(
    @Param('locator', new ZodValidationPipe(entityIdSchema)) locator: string
  ): Promise<CatalogSourceResponse> {
    return this.catalog.sourceDetail(locator)
  }
}
