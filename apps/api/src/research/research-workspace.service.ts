import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  researchWorkspaceSchema,
  researchReasoningSchema,
  researchAnswerSchema,
  researchSelectedPlanSchema,
  type ResearchWorkspaceAction,
  type ResearchWorkspace,
} from '@tech-scout/contracts'
import { PrismaService } from '../database/prisma.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { object, rows } from './research-view.service.js'
import * as queries from './research.repository.js'
import { ResearchService } from './research.service.js'
import {
  assertResearchPlanEditable,
  reachedResearchStage,
  researchStageProgress,
  revision,
  selectedPlan,
} from './workspace-state.js'

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
const scope = (v: unknown) => {
  const p = object(v)
  return {
    from_year: p.from_year,
    to_year: p.to_year,
    pages_per_keyword: p.pages_per_keyword ?? 5,
    directions: rows(p.directions).map((d) => ({
      domain_id: d.domain_id,
      name: d.name,
      explanation: d.explanation,
      keywords: d.keywords,
    })),
  }
}
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = object(a),
      y = object(b)
    return (
      Object.keys(x).length === Object.keys(y).length &&
      Object.keys(x).every((k) => same(x[k], y[k]))
    )
  }
  return a === b
}

@Injectable()
export class ResearchWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly research: ResearchService
  ) {}

  async get(userId: string, projectId: string): Promise<ResearchWorkspace> {
    const project = await this.prisma.researchProject.findFirst({
      where: { id: projectId, userId },
    })
    if (!project) throw new NotFoundException('研究项目不存在')
    // Project history needs only messages/plans, never patent snapshots or model payloads.
    const runs = await queries.workspaceRuns(this.prisma, projectId)
    const ws = object(project.workspace)
    const selected = selectedPlan(
      ws,
      runs.findLast((r) => r.confirmed)?.confirmed
    )
    const latest = runs.at(-1)
    const messages: ResearchWorkspace['messages'] = []
    let candidates: unknown = null
    for (const r of runs) {
      const id = String(r.id),
        createdAt = (r.createdAt as Date).toISOString()
      const ctx = object(r.context)
      const nextCandidates = r.candidates ?? r.plan ?? ctx.candidatePlan
      if (nextCandidates) candidates = nextCandidates
      if (ctx.startSearch) continue
      messages.push({
        id: `${id}:question`,
        runId: id,
        role: 'user',
        reasoning: null,
        answer: null,
        pending: false,
        text: String(r.question),
        createdAt,
        plan: null,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
      })
      const applied = rows(ws.changes).some((c) => c.proposalRunId === id)
      const proposal = r.proposal != null
      const recommendation = Boolean(
        (r.candidates ?? r.plan) &&
        !ctx.startSearch &&
        !r.confirmed &&
        !proposal &&
        !r.hasResult &&
        (!ctx.workspace ||
          ['refresh_candidates', 'update_candidate'].includes(String(r.intent)))
      )
      const pending =
        !ctx.startSearch &&
        !r.reply &&
        !r.plan &&
        ['queued', 'running'].includes(String(r.status))
      const reasoning = researchReasoningSchema.nullable().parse(r.reasoning)
      const answer = researchAnswerSchema.nullable().parse(r.answer)
      if (
        answer?.status === 'streaming' &&
        !['queued', 'running'].includes(String(r.status))
      )
        answer.status = 'interrupted'
      if (
        reasoning &&
        !['queued', 'running'].includes(String(r.status)) &&
        ['thinking', 'answering'].includes(reasoning.status)
      )
        reasoning.status = 'interrupted'
      if (
        r.reply ||
        r.plan ||
        r.confirmed ||
        r.hasResult ||
        pending ||
        reasoning ||
        answer
      ) {
        const failed =
          typeof r.reply !== 'string' && !r.confirmed && !pending && !answer
        messages.push({
          id: `${id}:reply`,
          runId: id,
          role: 'assistant',
          reasoning,
          answer,
          pending,
          failed,
          text:
            typeof r.reply === 'string'
              ? r.reply
              : r.confirmed && !recommendation
                ? '已确认研究计划。'
                : pending || answer
                  ? ''
                  : '本次回复未完成，可重试。',
          createdAt,
          recommendation,
          plan: recommendation
            ? researchSelectedPlanSchema.parse(r.candidates ?? r.plan)
            : r.proposal
              ? researchSelectedPlanSchema.parse(r.proposal)
              : r.confirmed
                ? researchSelectedPlanSchema.parse(r.confirmed)
                : r.plan &&
                    !['discuss', 'propose_selected'].includes(String(r.intent))
                  ? researchSelectedPlanSchema.parse(r.plan)
                  : null,
          proposal,
          applied,
          outdated: proposal
            ? revision(ws) !== Number(ctx.selectedRevision ?? 0) && !applied
            : false,
          hasResult: r.hasResult === true,
        })
      }
    }
    const latestRecommendation = messages.findLast((m) => m.recommendation)?.id
    for (const message of messages) {
      if (message.recommendation)
        message.outdated = message.id !== latestRecommendation
      else if (
        message.role === 'assistant' &&
        message.plan &&
        !message.proposal
      ) {
        const r = runs.find((r) => r.id === message.runId)
        message.outdated = !same(
          scope(message.plan),
          scope(r?.confirmed ? selected : candidates)
        )
      }
    }
    const commands = await this.prisma.researchCommand.findMany({
      where: { run: { projectId }, status: 'sent' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const result = runs.findLast((r) => r.hasResult)
    const pending = await this.prisma.researchCommand.count({
      where: { run: { projectId }, status: 'pending' },
    })
    const startedRunIds = new Set(
      commands
        .filter((command) =>
          ['confirm_plan', 'start_companies'].includes(
            String(object(command.payload).kind)
          )
        )
        .map((command) => command.runId)
    )
    const execution = runs.findLast(
      (r) =>
        reachedResearchStage([r]) !== 'plan' || startedRunIds.has(String(r.id))
    )
    const progress = researchStageProgress(
      execution ?? latest,
      commands,
      selected.directions.length > 0
    )
    return researchWorkspaceSchema.parse({
      researchCompleted: runs.some((r) =>
        ['completed', 'empty'].includes(String(r.status))
      ),
      ...progress,
      revision: revision(ws),
      selectedPlan: selected,
      candidates,
      messages,
      latestResultRunId: result?.id ?? null,
      resultOutdated: Boolean(
        result && !same(scope(selected), scope(result.confirmed))
      ),
      activeRunId: latest?.id ?? null,
      executionRunId: execution?.id ?? null,
      blocked:
        pending > 0 ||
        runs.some((r) => ['queued', 'running'].includes(String(r.status))),
    })
  }

  async action(
    userId: string,
    projectId: string,
    input: ResearchWorkspaceAction
  ) {
    await this.research.project(userId, projectId)
    if (input.kind === 'start_search') {
      await this.research.newRun(
        userId,
        projectId,
        {
          question: '确认已选研究计划并开始检索',
          thinking: false,
          requestKey: input.requestKey,
        },
        input.revision
      )
      return this.get(userId, projectId)
    }
    await this.prisma.$transaction(async (tx) => {
      await queries.lockProject(tx, projectId)
      const project = await tx.researchProject.findUniqueOrThrow({
        where: { id: projectId },
      })
      const ws = object(project.workspace),
        changes = rows(ws.changes)
      const existing = changes.find((c) => c.id === input.requestKey)
      if (existing) {
        if (!same(existing.input, input))
          throw new ConflictException('请求 ID 已用于不同调整')
        return
      }
      if (revision(ws) !== input.revision)
        throw new ConflictException('已选计划已有更新，请刷新后再保存')
      const active = await tx.researchRun.count({
        where: { projectId, status: { in: ['queued', 'running'] } },
      })
      const pending = await tx.researchCommand.count({
        where: { run: { projectId }, status: 'pending' },
      })
      if (active || pending)
        throw new ConflictException('请等待当前研究结束或停止后再调整')
      await assertResearchPlanEditable(tx, projectId)
      let next: unknown
      if (input.kind === 'save_plan') next = input.plan
      else {
        const proposal = await tx.researchRun.findFirst({
          where: { id: input.proposalRunId, projectId },
        })
        if (
          !proposal ||
          Number(object(proposal.context).selectedRevision ?? -1) !==
            input.revision
        )
          throw new ConflictException('修改建议已过期，请重新提出修改')
        next = object(object(proposal.state).artifacts).proposal_plan
        if (!next) throw new ConflictException('修改建议尚未生成')
      }
      const plan = researchSelectedPlanSchema.parse(next)
      if (plan.to_year > new Date().getFullYear())
        throw new ConflictException('公开年份不能晚于当前年份')
      if (
        new Set(plan.directions.map((d) => d.domain_id)).size !==
        plan.directions.length
      )
        throw new ConflictException('技术方向标识不能重复')
      const previousRun = await tx.researchRun.findFirst({
        where: {
          projectId,
          state: { path: ['artifacts', 'confirmed_plan'], not: Prisma.DbNull },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      const before = selectedPlan(
        ws,
        object(object(previousRun?.state).artifacts).confirmed_plan
      )
      if (input.kind === 'apply_proposal')
        plan.pages_per_keyword = before.pages_per_keyword
      const added = plan.directions
        .filter(
          (d) => !before.directions.some((p) => p.domain_id === d.domain_id)
        )
        .map((d) => d.name)
      const removed = before.directions
        .filter(
          (d) => !plan.directions.some((p) => p.domain_id === d.domain_id)
        )
        .map((d) => d.name)
      const updated = plan.directions
        .filter((d) =>
          before.directions.some(
            (p) => p.domain_id === d.domain_id && !same(d, p)
          )
        )
        .map((d) => d.name)
      const text = [
        input.kind === 'apply_proposal'
          ? '已应用 AI 修改建议。'
          : '已保存研究计划。',
        added.length ? `加入：${added.join('、')}。` : '',
        removed.length ? `移除：${removed.join('、')}。` : '',
        updated.length ? `修改：${updated.join('、')}。` : '',
        before.pages_per_keyword !== plan.pages_per_keyword
          ? `检索深度：每个关键词最多 ${plan.pages_per_keyword} 页。`
          : '',
        before.from_year !== plan.from_year || before.to_year !== plan.to_year
          ? `公开年份：${plan.from_year}–${plan.to_year}。`
          : '',
      ].join('')
      changes.push({
        id: input.requestKey,
        input,
        proposalRunId:
          input.kind === 'apply_proposal' ? input.proposalRunId : null,
        revision: input.revision + 1,
        createdAt: new Date().toISOString(),
        text,
        plan,
      })
      await tx.researchProject.update({
        where: { id: projectId },
        data: {
          workspace: json({
            ...ws,
            revision: input.revision + 1,
            selectedPlan: plan,
            changes,
          }),
        },
      })
    })
    return this.get(userId, projectId)
  }
}
