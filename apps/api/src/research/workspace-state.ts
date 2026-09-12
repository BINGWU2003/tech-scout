import { researchSelectedPlanSchema } from '@tech-scout/contracts'
import { object } from './research-view.service.js'

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
