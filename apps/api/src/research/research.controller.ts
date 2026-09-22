import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  researchActionSchema,
  researchCreateSchema,
  researchEventsQuerySchema,
  researchProjectSchema,
  researchProjectSummarySchema,
  researchRunSchema,
  researchStoredEventSchema,
  researchKeywordRequestSchema,
  type ResearchAction,
  type ResearchCreate,
} from '@tech-scout/contracts'
import { type Request, type Response } from 'express'
import { z } from 'zod'
import { AuthGuard } from '../auth/auth.guard.js'
import { type AuthenticatedRequest } from '../auth/auth.types.js'
import { CsrfGuard } from '../auth/csrf.guard.js'
import { CurrentAuth } from '../auth/current-auth.decorator.js'
import { ZodResponse } from '../common/zod-response.decorator.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { ResearchService } from './research.service.js'

const uuid = new ZodValidationPipe(z.uuid())

@Controller('research')
@UseGuards(AuthGuard)
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('projects')
  @ZodResponse(researchProjectSchema)
  @UseGuards(CsrfGuard)
  create(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Body(new ZodValidationPipe(researchCreateSchema)) input: ResearchCreate
  ) {
    return this.research.create(auth.user.id, input)
  }

  @Get('projects')
  @ZodResponse(z.array(researchProjectSummarySchema))
  list(@CurrentAuth() auth: AuthenticatedRequest['auth']) {
    return this.research.list(auth.user.id)
  }

  @Delete('projects/:projectId')
  @ZodResponse(
    z.object({ deleted: z.literal(true), runIds: z.array(z.uuid()) })
  )
  @UseGuards(CsrfGuard)
  deleteProject(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('projectId', uuid) id: string
  ) {
    return this.research.deleteProject(auth.user.id, id)
  }

  @Get('projects/:projectId')
  @ZodResponse(researchProjectSchema)
  project(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('projectId', uuid) id: string
  ) {
    return this.research.project(auth.user.id, id)
  }

  @Post('projects/:projectId/runs')
  @ZodResponse(researchRunSchema)
  @UseGuards(CsrfGuard)
  newRun(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(researchCreateSchema)) input: ResearchCreate
  ) {
    return this.research.newRun(auth.user.id, id, input)
  }

  @Post('projects/:projectId/keywords')
  @ZodResponse(researchRunSchema)
  @UseGuards(CsrfGuard)
  keywords(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('projectId', uuid) id: string,
    @Body(new ZodValidationPipe(researchKeywordRequestSchema)) input: z.infer<
      typeof researchKeywordRequestSchema
    >
  ) {
    return this.research.newRun(
      auth.user.id,
      id,
      {
        requestKey: input.requestKey,
        question: `生成“${input.direction.name}”的检索关键词`,
        thinking: false,
      },
      undefined,
      input.direction
    )
  }

  @Get('runs/:runId')
  @ZodResponse(researchRunSchema)
  run(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('runId', uuid) id: string
  ) {
    return this.research.run(auth.user.id, id)
  }

  @Post('runs/:runId/actions')
  @ZodResponse(researchRunSchema)
  @UseGuards(CsrfGuard)
  action(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('runId', uuid) id: string,
    @Body(new ZodValidationPipe(researchActionSchema)) input: ResearchAction
  ) {
    return this.research.action(auth.user.id, id, input)
  }

  @Get('runs/:runId/events')
  @ZodResponse(z.array(researchStoredEventSchema))
  events(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchEventsQuerySchema)) query: {
      after: number
    }
  ) {
    return this.research.events(auth.user.id, id, query.after)
  }

  @Get('runs/:runId/stream')
  async stream(
    @CurrentAuth() auth: AuthenticatedRequest['auth'],
    @Param('runId', uuid) id: string,
    @Query(new ZodValidationPipe(researchEventsQuerySchema)) query: {
      after: number
    },
    @Req() request: Request,
    @Res() response: Response
  ) {
    await this.research.ownedRun(auth.user.id, id)
    const cursor = researchEventsQuerySchema.safeParse({
      after: request.header('Last-Event-ID') ?? query.after,
    })
    if (!cursor.success)
      throw new BadRequestException({
        code: 'INVALID_EVENT_CURSOR',
        message: '事件游标必须是非负整数',
      })
    let after = cursor.data.after
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.flushHeaders()
    let closed = false
    response.on('close', () => {
      closed = true
    })
    try {
      while (!closed) {
        const events = await this.research.events(auth.user.id, id, after)
        for (const event of events) {
          response.write(
            `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`
          )
          after = event.sequence
        }
        if (!events.length) response.write(': keepalive\n\n')
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error
    } finally {
      response.end()
    }
  }
}
