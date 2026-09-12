import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  researchConflictPageSchema,
  researchWorkspaceSchema,
  researchWorkspaceActionSchema,
  type ResearchWorkspaceAction,
  researchActionSchema,
  researchCreateSchema,
  researchEventsQuerySchema,
  researchSummaryViewSchema,
  researchProgressViewSchema,
  researchResultViewSchema,
  researchPatentPageSchema,
  researchPatentStatsSchema,
  researchCandidatePageSchema,
  researchCandidateDetailViewSchema,
  researchCompanyDetailViewSchema,
  researchCompanyMatchesSchema,
  researchCompanyStatsSchema,
  researchViewQuerySchema,
  type ResearchAction,
  type ResearchCreate,
  type ResearchViewQuery,
} from '@tech-scout/contracts'
import { type Request, type Response } from 'express'
import { z } from 'zod'
import { AuthGuard } from '../auth/auth.guard.js'
import { type AuthenticatedRequest } from '../auth/auth.types.js'
import { CsrfGuard } from '../auth/csrf.guard.js'
import { CurrentAuth } from '../auth/current-auth.decorator.js'
import { ZodResponse } from '../common/zod-response.decorator.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { ResearchViewService } from './research-view.service.js'
import { ResearchWorkspaceService } from './research-workspace.service.js'
import { ResearchService } from './research.service.js'

const uuid = new ZodValidationPipe(z.uuid())
const key = new ZodValidationPipe(z.string().min(1).max(255))
type Auth = AuthenticatedRequest['auth']

@Controller('research/ui')
@UseGuards(AuthGuard)
export class ResearchViewController {
  constructor(
    private readonly view: ResearchViewService,
    private readonly research: ResearchService,
    private readonly workspace: ResearchWorkspaceService
  ) {}

  @Get('projects/:projectId/workspace')
  @ZodResponse(researchWorkspaceSchema)
  getWorkspace(
    @CurrentAuth() auth: Auth,
    @Param('projectId', uuid) id: string
  ) {
    return this.workspace.get(auth.user.id, id)
  }

  @Post('projects/:projectId/workspace')
  @UseGuards(CsrfGuard)
  @ZodResponse(researchWorkspaceSchema)
  updateWorkspace(
    @CurrentAuth() auth: Auth,
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(researchWorkspaceActionSchema))
    input: ResearchWorkspaceAction
  ) {
    return this.workspace.action(auth.user.id, id, input)
  }

  @Get('runs/:runId')
  @ZodResponse(researchSummaryViewSchema)
  summary(@CurrentAuth() auth: Auth, @Param('runId', uuid) id: string) {
    return this.view.summary(auth.user.id, id)
  }

  @Post('projects/:projectId/runs')
  @UseGuards(CsrfGuard)
  @ZodResponse(researchSummaryViewSchema)
  async newRun(
    @CurrentAuth() auth: Auth,
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(researchCreateSchema)) input: ResearchCreate
  ) {
    const run = await this.research.newRun(auth.user.id, id, input)
    return this.view.summary(auth.user.id, run.id)
  }

  @Post('runs/:runId/actions')
  @UseGuards(CsrfGuard)
  @ZodResponse(researchSummaryViewSchema)
  async action(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Body(new ZodValidationPipe(researchActionSchema)) input: ResearchAction
  ) {
    await this.research.action(auth.user.id, id, input)
    return this.view.summary(auth.user.id, id)
  }

  @Get('runs/:runId/result')
  @ZodResponse(researchResultViewSchema)
  result(@CurrentAuth() auth: Auth, @Param('runId', uuid) id: string) {
    return this.view.result(auth.user.id, id)
  }

  @Get('runs/:runId/conflicts')
  @ZodResponse(researchConflictPageSchema)
  conflicts(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchViewQuerySchema)) q: ResearchViewQuery
  ) {
    return this.view.conflicts(auth.user.id, id, q)
  }

  @Get('runs/:runId/patents')
  @ZodResponse(researchPatentPageSchema)
  patents(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchViewQuerySchema)) q: ResearchViewQuery
  ) {
    return this.view.patents(auth.user.id, id, q)
  }

  @Get('runs/:runId/patent-stats')
  @ZodResponse(researchPatentStatsSchema)
  patentStats(@CurrentAuth() auth: Auth, @Param('runId', uuid) id: string) {
    return this.view.patentStats(auth.user.id, id)
  }

  @Get('runs/:runId/candidates')
  @ZodResponse(researchCandidatePageSchema)
  candidates(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchViewQuerySchema)) q: ResearchViewQuery
  ) {
    return this.view.candidates(auth.user.id, id, q)
  }

  @Get('runs/:runId/company-stats')
  @ZodResponse(researchCompanyStatsSchema)
  companyStats(@CurrentAuth() auth: Auth, @Param('runId', uuid) id: string) {
    return this.view.companyStats(auth.user.id, id)
  }

  @Get('runs/:runId/companies')
  @ZodResponse(researchCompanyMatchesSchema)
  companyMatches(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchViewQuerySchema)) q: ResearchViewQuery
  ) {
    return this.view.companyMatches(auth.user.id, id, q)
  }

  @Get('runs/:runId/candidates/:candidateId')
  @ZodResponse(researchCandidateDetailViewSchema)
  candidate(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Param('candidateId', key) cid: string
  ) {
    return this.view.candidate(auth.user.id, id, cid)
  }

  @Get('runs/:runId/companies/:companyId')
  @ZodResponse(researchCompanyDetailViewSchema)
  company(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Param('companyId', key) cid: string
  ) {
    return this.view.company(auth.user.id, id, cid)
  }

  @Get('runs/:runId/events')
  @ZodResponse(z.array(researchProgressViewSchema))
  events(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchEventsQuerySchema)) q: {
      after: number
    }
  ) {
    return this.view.events(auth.user.id, id, q.after)
  }

  @Get('runs/:runId/stream')
  async stream(
    @CurrentAuth() auth: Auth,
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchEventsQuerySchema)) q: {
      after: number
    },
    @Req() request: Request,
    @Res() response: Response
  ) {
    const parsed = researchEventsQuerySchema.safeParse({
      after: request.header('Last-Event-ID') ?? q.after,
    })
    if (!parsed.success) throw new BadRequestException('事件游标必须是非负整数')
    let after = parsed.data.after
    // Query before sending headers so auth/ownership errors remain ordinary HTTP errors.
    let events = await this.view.events(auth.user.id, id, after)
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.flushHeaders()
    let closed = false
    response.on('close', () => {
      closed = true
    })
    try {
      while (!closed) {
        for (const event of events) {
          const checked = researchProgressViewSchema.parse(event)
          response.write(
            `id: ${checked.sequence}\ndata: ${JSON.stringify(checked)}\n\n`
          )
          after = checked.sequence
        }
        if (!events.length) response.write(': keepalive\n\n')
        await new Promise((resolve) => setTimeout(resolve, 1500))
        if (!closed) events = await this.view.events(auth.user.id, id, after)
      }
    } finally {
      response.end()
    }
  }
}
