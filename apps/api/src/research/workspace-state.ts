import { ConflictException } from '@nestjs/common'
import { researchSelectedPlanSchema } from '@tech-scout/contracts'
import type { Prisma } from '../generated/prisma/client.js'
import { object } from './research-view.service.js'

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
      ['evidence', 'finish'].includes(node) ||
      (node === 'entity' && status === 'queued')
    )
      reached = Math.max(reached, 3)
    else if (
      ['company_snapshot', 'company', 'entity'].includes(node) ||
      status === 'awaiting_entities' ||
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
