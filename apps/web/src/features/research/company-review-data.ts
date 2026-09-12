import {
  researchActionSchema,
  type ResearchProgressView,
} from '@tech-scout/contracts'

export function companyRecords(events: ResearchProgressView[]) {
  const records = new Map<string, ResearchProgressView>()
  for (const event of events) {
    if (event.acquisition) continue
    if (
      event.process ||
      event.error ||
      ['node_completed', 'execution_stopped'].includes(event.kind)
    )
      records.set(
        event.process
          ? event.process.direction &&
            !['failed', 'stopped'].includes(event.process.outcome)
            ? `${event.process.stage}:${event.process.direction}`
            : `${event.process.stage}:${event.process.direction}:${event.process.message}:${event.process.outcome}`
          : `${event.node}:${event.kind}`,
        event
      )
  }
  return [...records.values()].sort((a, b) => a.sequence - b.sequence)
}
export function loadReviewDraft(key: string | null, pending: string[]) {
  if (!key) return {}
  try {
    const parsed = researchActionSchema.shape.decisions.safeParse(
      JSON.parse(localStorage.getItem(key) ?? '[]')
    )
    return parsed.success
      ? Object.fromEntries(
          parsed.data
            .filter(
              (d) =>
                pending.includes(d.candidate_id) &&
                (d.action !== 'confirm' ||
                  Boolean(d.company_id && d.evidence_ids.length))
            )
            .map((d) => [d.candidate_id, d])
        )
      : {}
  } catch {
    return {}
  }
}
