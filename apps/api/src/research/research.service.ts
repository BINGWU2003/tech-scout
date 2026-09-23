import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import {
  researchPlanSchema,
  researchActivityLabel,
  type ResearchAction,
  type ResearchCreate,
  type ResearchEvent,
  type ResearchState,
} from '@tech-scout/contracts'
import { PrismaService } from '../database/prisma.service.js'
import { type Action } from '../generated/intelligence/types.gen.js'
import { Prisma, type ResearchRun } from '../generated/prisma/client.js'
import { IntelligenceClient } from './intelligence.client.js'
import { object } from './research-view.service.js'
import * as queries from './research.repository.js'
import {
  assertResearchNotCompleted,
  assertResearchPlanEditable,
  revision,
  selectedPlan,
} from './workspace-state.js'

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue

@Injectable()
export class ResearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResearchService.name)
  private timer?: ReturnType<typeof setInterval>
  private readonly streams = new Map<string, AbortController>()
  private readonly syncing = new Set<string>()
  private stopped = false
  private ticking = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: IntelligenceClient
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick()
    }, 2000)
    this.timer.unref()
  }

  onModuleDestroy() {
    this.stopped = true
    clearInterval(this.timer)
    for (const stream of this.streams.values()) stream.abort()
  }

  async create(userId: string, input: ResearchCreate) {
    const project = await this.prisma.researchProject
      .upsert({
        where: { userId_requestKey: { userId, requestKey: input.requestKey } },
        update: {},
        create: {
          userId,
          requestKey: input.requestKey,
          question: input.question,
          title: input.question.slice(0, 200),
          runs: {
            create: {
              question: input.question,
              requestKey: input.requestKey,
              context: { thinking: input.thinking },
            },
          },
        },
        include: { runs: { orderBy: { createdAt: 'asc' } } },
      })
      .catch(async (error) => {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        )
          throw error
        return this.prisma.researchProject.findUniqueOrThrow({
          where: {
            userId_requestKey: { userId, requestKey: input.requestKey },
          },
          include: { runs: { orderBy: { createdAt: 'asc' } } },
        })
      })
    if (
      project.question !== input.question ||
      object(project.runs[0].context).thinking !== input.thinking
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '请求键已用于不同问题',
      })
    await this.sync(project.runs[0])
    return this.project(userId, project.id)
  }

  async list(userId: string) {
    const projects = await queries.listProjects(this.prisma, userId)
    return projects.map(
      ({
        runId,
        status,
        sequence,
        node,
        reasoning,
        error,
        acquisition,
        ...p
      }) => {
        const label = researchActivityLabel(
          { status, node, error, acquisition },
          reasoning
        )
        return {
          ...p,
          createdAt: p.createdAt.toISOString(),
          activity: runId ? { runId, status, sequence, label } : null,
        }
      }
    )
  }

  async project(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findFirst({
      where: { id: projectId, userId },
      include: {
        runs: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            question: true,
            status: true,
            sequence: true,
            createdAt: true,
          },
        },
      },
    })
    if (!project) throw new NotFoundException('研究项目不存在')
    return {
      id: project.id,
      title: project.title,
      question: project.question,
      createdAt: project.createdAt.toISOString(),
      runs: project.runs.map((run) => ({
        ...run,
        createdAt: run.createdAt.toISOString(),
      })),
    }
  }

  async deleteProject(userId: string, projectId: string) {
    const runIds = await this.prisma.$transaction(
      async (tx) => {
        // Use the same lock as new rounds/actions so deletion includes every run.
        await queries.lockProject(tx, projectId, userId)
        const project = await tx.researchProject.findFirst({
          where: { id: projectId, userId },
          include: { runs: { select: { id: true } } },
        })
        // Idempotent retries also cover a lost successful response; disclose no ownership.
        if (!project) return []
        for (const run of project.runs) await this.intelligence.delete(run.id)
        await tx.researchProject.delete({ where: { id: projectId } })
        return project.runs.map((run) => run.id)
      },
      { timeout: 120000 }
    )
    for (const runId of runIds) this.streams.get(runId)?.abort()
    return { deleted: true as const, runIds }
  }

  async newRun(
    userId: string,
    projectId: string,
    input: ResearchCreate,
    searchRevision?: number,
    keywordDirection?: { domain_id: string; name: string; explanation: string }
  ) {
    const project = await this.project(userId, projectId)
    const run = await this.prisma.$transaction(async (tx) => {
      // Serialize new rounds across tabs so a project has a single active branch.
      await queries.lockProject(tx, projectId)
      const existing = await tx.researchRun.findUnique({
        where: {
          projectId_requestKey: { projectId, requestKey: input.requestKey },
        },
      })
      if (existing) {
        if (
          existing.question !== input.question ||
          JSON.stringify(object(existing.context).keywordDirection ?? null) !==
            JSON.stringify(keywordDirection ?? null) ||
          object(existing.context).thinking !== input.thinking ||
          Boolean(object(existing.context).startSearch) !==
            (searchRevision !== undefined) ||
          (searchRevision !== undefined &&
            object(existing.context).selectedRevision !== searchRevision) ||
          (input.parentRunId &&
            object(existing.context).parentRunId !== input.parentRunId)
        )
          throw new ConflictException('请求键已用于不同的追问')
        return existing
      }
      const workspace = (
        await tx.researchProject.findUniqueOrThrow({ where: { id: projectId } })
      ).workspace
      if (
        searchRevision !== undefined &&
        revision(workspace) !== searchRevision
      )
        throw new ConflictException('已选计划已有更新，请刷新后确认')
      const previous = await tx.researchRun.findFirst({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      if (input.parentRunId && previous?.id !== input.parentRunId)
        throw new ConflictException('研究已有更新，请刷新后继续追问')
      const active = await tx.researchRun.findFirst({
        where: { projectId, status: { in: ['queued', 'running'] } },
        select: { id: true },
      })
      const pending = await tx.researchCommand.findFirst({
        where: { run: { projectId }, status: 'pending' },
        select: { id: true },
      })
      if (active || pending)
        throw new ConflictException('请等待当前研究结束或停止后再发送')
      await assertResearchPlanEditable(tx, projectId)
      const previousContext = object(previous?.context)
      const artifacts = object(object(previous?.state).artifacts)
      const confirmed = await tx.researchRun.findFirst({
        where: {
          projectId,
          state: { path: ['artifacts', 'confirmed_plan'], not: Prisma.DbNull },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      const selected = selectedPlan(
        workspace,
        object(object(confirmed?.state).artifacts).confirmed_plan
      )
      if (
        searchRevision !== undefined &&
        !researchPlanSchema.safeParse(selected).success
      )
        throw new ConflictException('请先选择至少一个研究方向')
      if (
        searchRevision !== undefined &&
        selected.directions.some((d) => !d.keywords.length)
      )
        throw new ConflictException('每个方向至少需要一个检索关键词')
      const messages = await queries.conversationHistory(tx, projectId)
      const messageHistory = messages.reverse()
      return tx.researchRun.create({
        data: {
          projectId,
          requestKey: input.requestKey,
          question: input.question,
          context: json({
            workspace: true,
            ...(keywordDirection ? { keywordDirection } : {}),
            thinking: input.thinking,
            selectedPlan: selected,
            selectedRevision: revision(workspace),
            messages: messageHistory,
            candidatePlan:
              artifacts.candidate_plan ??
              artifacts.plan ??
              previousContext.candidatePlan ??
              null,
            startSearch: searchRevision !== undefined,
            parentRunId: previous?.id,
            originalQuestion: project.question,
            questions: messageHistory.map((message) =>
              String(message.question)
            ),
            plan:
              artifacts.confirmed_plan ??
              artifacts.plan ??
              previousContext.plan ??
              null,
          }),
        },
      })
    })
    if (run.question !== input.question)
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '请求键已用于不同问题',
      })
    await this.sync(run)
    return this.run(userId, run.id)
  }

  async ownedRun(userId: string, runId: string) {
    const run = await this.prisma.researchRun.findFirst({
      where: { id: runId, project: { userId } },
    })
    if (!run) throw new NotFoundException('研究运行不存在')
    return run
  }

  async run(userId: string, runId: string) {
    const run = await this.ownedRun(userId, runId)
    return {
      id: run.id,
      projectId: run.projectId,
      question: run.question,
      status: run.status,
      sequence: run.sequence,
      state: run.state,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    }
  }

  async action(userId: string, runId: string, input: ResearchAction) {
    const owned = await this.ownedRun(userId, runId)
    const payload: Action = { ...input, actor_id: userId }
    const command = await this.prisma.$transaction(async (tx) => {
      await queries.lockProject(tx, owned.projectId)
      const existing = await tx.researchCommand.findUnique({
        where: { id: input.action_id },
      })
      if (existing) return existing
      const latest = await tx.researchRun.findFirst({
        where: { projectId: owned.projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
      const execution = await tx.researchRun.findFirst({
        where: {
          projectId: owned.projectId,
          OR: [
            { context: { path: ['startSearch'], equals: true } },
            {
              state: {
                path: ['artifacts', 'confirmed_plan'],
                not: Prisma.DbNull,
              },
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
      const canContinue =
        execution?.id === runId &&
        ['start_companies', 'retry'].includes(input.kind)
      if (
        latest?.id !== runId &&
        !canContinue &&
        !['cancel', 'pause'].includes(input.kind)
      )
        throw new ConflictException('此记录已归入历史，请返回当前研究继续操作')
      if (!['cancel', 'pause'].includes(input.kind)) {
        const otherActive = await tx.researchRun.count({
          where: {
            projectId: owned.projectId,
            id: { not: runId },
            status: { in: ['queued', 'running'] },
          },
        })
        if (otherActive)
          throw new ConflictException('请等待当前研究结束或停止后再操作')
      }
      if (input.kind === 'confirm_plan')
        await assertResearchPlanEditable(tx, owned.projectId)
      if (['confirm_plan', 'start_companies', 'retry'].includes(input.kind)) {
        // Follow-up chat retries remain available; execution cannot restart a completed task.
        const artifacts = object(object(owned.state).artifacts)
        if (
          input.kind !== 'retry' ||
          object(owned.context).startSearch ||
          artifacts.confirmed_plan
        )
          await assertResearchNotCompleted(tx, owned.projectId)
      }
      return tx.researchCommand.create({
        data: { id: input.action_id, runId, payload: json(payload) },
      })
    })
    if (
      command.runId !== runId ||
      JSON.stringify(command.payload) !== JSON.stringify(json(payload))
    ) {
      // PostgreSQL jsonb key ordering is not a payload identity guarantee.
      if (
        command.runId !== runId ||
        canonical(command.payload) !== canonical(payload)
      ) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: '动作 ID 已用于不同请求',
        })
      }
    }
    if (command.status === 'rejected')
      throw new ConflictException(command.error ?? '动作已被拒绝')
    if (command.status === 'pending')
      await this.dispatch(command.id, runId, payload)
    return this.run(userId, runId)
  }

  async events(userId: string, runId: string, after: number) {
    await this.ownedRun(userId, runId)
    const events = await this.prisma.researchEvent.findMany({
      where: { runId, sequence: { gt: after } },
      orderBy: { sequence: 'asc' },
      take: 100,
    })
    return events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))
  }

  async receive(event: ResearchEvent) {
    const state = event.data
    if (event.sequence !== state.sequence)
      throw new Error('Event sequence mismatch')
    await this.prisma.$transaction(async (tx) => {
      // Fence late stream events against the cascading project deletion.
      const runs = await queries.lockRun(tx, state.run_id)
      if (!runs.length) return
      await tx.researchEvent.upsert({
        where: {
          runId_sequence: { runId: state.run_id, sequence: event.sequence },
        },
        update: {},
        create: {
          runId: state.run_id,
          sequence: event.sequence,
          kind: event.kind,
          data: json(state),
          createdAt: new Date(event.created_at),
        },
      })
      await tx.researchRun.updateMany({
        where: { id: state.run_id, sequence: { lt: state.sequence } },
        data: {
          status: state.status,
          sequence: state.sequence,
          state: json(state),
        },
      })
    })
  }

  private async save(state: ResearchState) {
    await this.prisma.researchRun.updateMany({
      where: { id: state.run_id, sequence: { lte: state.sequence } },
      data: {
        status: state.status,
        sequence: state.sequence,
        state: json(state),
      },
    })
  }

  private async dispatch(id: string, runId: string, payload: Action) {
    try {
      const state = await this.intelligence.action(runId, payload)
      await this.save(state)
      await this.prisma.researchCommand.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'sent' },
      })
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        await this.prisma.researchCommand.updateMany({
          where: { id },
          data: { status: 'rejected', error: json(error.getResponse()) },
        })
      }
      throw error
    }
  }

  async sync(run: ResearchRun) {
    if (this.syncing.has(run.id)) return
    this.syncing.add(run.id)
    try {
      await this.save(
        await this.intelligence.start(run.id, run.question, object(run.context))
      )
      const latest = await this.prisma.researchEvent.findFirst({
        where: { runId: run.id },
        orderBy: { sequence: 'desc' },
      })
      let after = latest?.sequence ?? 0
      for (;;) {
        const events = await this.intelligence.events(run.id, after)
        for (const event of events) {
          await this.receive(event)
          after = event.sequence
        }
        if (events.length < 20) break
      }
      const lastEvent = await this.prisma.researchEvent.findFirst({
        where: { runId: run.id },
        orderBy: { sequence: 'desc' },
      })
      const current = await this.prisma.researchRun.findUnique({
        where: { id: run.id },
      })
      if (!current) return
      if (
        !(
          lastEvent?.kind === 'execution_stopped' &&
          lastEvent.sequence === current.sequence
        ) &&
        current.status !== 'cancelled'
      )
        this.listen(run.id, after)
    } finally {
      this.syncing.delete(run.id)
    }
  }

  private listen(runId: string, after: number) {
    if (this.stopped || this.streams.has(runId)) return
    const controller = new AbortController()
    this.streams.set(runId, controller)
    void (async () => {
      try {
        for await (const event of this.intelligence.stream(
          runId,
          after,
          controller.signal
        )) {
          if (event.data.run_id !== runId) throw new Error('Cross-run event')
          await this.receive(event)
          if (
            event.kind === 'execution_stopped' ||
            event.data.status === 'cancelled'
          )
            break
        }
      } catch {
        if (!this.stopped)
          this.logger.warn({ code: 'INTELLIGENCE_STREAM_INTERRUPTED', runId })
      } finally {
        controller.abort()
        this.streams.delete(runId)
      }
    })()
  }

  private async tick() {
    if (this.stopped || this.ticking || !this.intelligence.configured) return
    this.ticking = true
    try {
      const commands = await this.prisma.researchCommand.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 20,
      })
      for (const command of commands) {
        try {
          await this.dispatch(
            command.id,
            command.runId,
            command.payload as unknown as Action
          )
        } catch {
          this.logger.warn({
            code: 'RESEARCH_COMMAND_PENDING',
            commandId: command.id,
          })
        }
      }
      const runs = await this.prisma.researchRun.findMany({
        orderBy: { updatedAt: 'asc' },
        take: 20,
      })
      for (const run of runs)
        if (!this.streams.has(run.id)) {
          try {
            await this.sync(run)
          } catch {
            this.logger.warn({ code: 'RESEARCH_SYNC_PENDING', runId: run.id })
          }
        }
    } catch {
      this.logger.warn({ code: 'RESEARCH_RECONCILIATION_FAILED' })
    } finally {
      this.ticking = false
    }
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
