import { ConflictException } from '@nestjs/common'
import {
  researchSelectedPlanSchema,
  type ResearchWorkspace,
} from '@tech-scout/contracts'
import { Prisma } from '../generated/prisma/client.js'
import { object } from './research-view.service.js'

export async function assertResearchPlanEditable(
  tx: Prisma.TransactionClient,
  projectId: string
) {
  const execution = await tx.researchRun.findFirst({
    where: {
      projectId,
      OR: [
        { status: { in: ['completed', 'empty'] } },
        { context: { path: ['startSearch'], equals: true } },
        {
          state: { path: ['artifacts', 'confirmed_plan'], not: Prisma.DbNull },
        },
      ],
    },
    select: { id: true },
  })
  if (execution)
    throw new ConflictException(
      '技术方向已确认，不能修改计划或重复开始研究；请新建研究。'
    )
}

export async function assertResearchNotCompleted(
  tx: Prisma.TransactionClient,
  projectId: string
) {
  const completed = await tx.researchRun.findFirst({
    where: { projectId, status: { in: ['completed', 'empty'] } },
    select: { id: true },
  })
  if (completed)
    throw new ConflictException(
      '此任务已完成研究，不能重复研究或修改计划；请新建任务。'
    )
}

export function reachedResearchStage(runs: Record<string, unknown>[]) {
  let reached = 0
  for (const run of runs) {
    const node = String(run.errorNode ?? run.node ?? '')
    const status = String(run.status)
    if (
      run.hasResult ||
      ['completed', 'empty'].includes(status) ||
      ['assess_patents', 'analyze', 'finish'].includes(node)
    )
      reached = Math.max(reached, 3)
    else if (
      ['company_snapshot', 'company'].includes(node) ||
      (node === 'company_gate' && status === 'queued')
    )
      reached = Math.max(reached, 2)
    else if (
      run.confirmed ||
      object(run.context).startSearch ||
      ['search_planner', 'snapshot', 'patent', 'company_gate'].includes(node) ||
      status === 'awaiting_companies'
    )
      reached = Math.max(reached, 1)
  }
  return (['plan', 'patents', 'companies', 'report'] as const)[reached]
}

export function researchStageProgress(
  run: Record<string, unknown> | undefined,
  commands: Record<string, unknown>[],
  hasSelectedDirections: boolean
): Pick<ResearchWorkspace, 'reachedStage' | 'currentStageStatus'> {
  const sentStages = commands.flatMap((command) => {
    if (!run || command.runId !== run.id) return []
    const kind = object(command.payload).kind
    if (kind === 'start_companies') return [{ node: 'company_snapshot' }]
    if (kind === 'confirm_plan') return [{ node: 'patent' }]
    return []
  })
  const reachedStage = reachedResearchStage([
    ...(run ? [run] : []),
    ...sentStages,
  ])
  let currentStageStatus: ResearchWorkspace['currentStageStatus']
  if (run?.status === 'queued' || run?.status === 'running') {
    currentStageStatus = run.status
  } else if (run?.status === 'failed') {
    currentStageStatus = 'failed'
  } else if (run?.status === 'recoverable') {
    currentStageStatus = run.errorNode ? 'failed' : 'paused'
  } else if (run?.status === 'cancelled') {
    currentStageStatus = 'cancelled'
  } else if (reachedStage !== reachedResearchStage(run ? [run] : [])) {
    // The start command was accepted before the worker updated its state.
    currentStageStatus = 'queued'
  } else if (reachedStage === 'plan') {
    currentStageStatus = hasSelectedDirections
      ? 'awaiting_confirmation'
      : 'draft'
  } else {
    currentStageStatus = 'completed'
  }
  return { reachedStage, currentStageStatus }
}

export function selectedPlan(workspace: unknown, previous?: unknown) {
  const stored = object(workspace)
  return researchSelectedPlanSchema.parse(
    stored.selectedPlan ??
      previous ?? {
        directions: [],
        from_year: 1800,
        to_year: new Date().getFullYear(),
        risks: [],
      }
  )
}

export function revision(workspace: unknown) {
  return Number(object(workspace).revision ?? 0)
}
