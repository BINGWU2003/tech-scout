import type {
  ResearchProgressView,
  ResearchSummaryView,
} from '@tech-scout/contracts'

function mergeDetails(
  previous: ResearchSummaryView['acquisition'],
  next: NonNullable<ResearchSummaryView['acquisition']>
) {
  return {
    ...next,
    completed: next.completed ?? previous?.completed ?? null,
    total: next.total ?? previous?.total ?? null,
  }
}

export function patentSearchData(
  run: ResearchSummaryView,
  events: ResearchProgressView[]
) {
  const groups = new Map<
    string,
    {
      domainId: string
      direction: string
      keyword: string
      pages: Map<number, ResearchProgressView>
    }
  >()
  for (const direction of run.confirmedPlan?.directions ?? []) {
    for (const keyword of new Set(direction.keywords)) {
      groups.set(JSON.stringify([direction.domain_id, keyword]), {
        domainId: direction.domain_id,
        direction: direction.name,
        keyword,
        pages: new Map(),
      })
    }
  }
  const notices = new Map<string, ResearchProgressView>()
  let discovered: number | null = null
  let details: ResearchSummaryView['acquisition'] = null
  let detailSequence = -1
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const process = event.process
    if (process?.stage === 'search' && process.keyword) {
      const domainId =
        process.domainId ??
        run.confirmedPlan?.directions.find((d) => d.name === process.direction)
          ?.domain_id ??
        ''
      const key = JSON.stringify([domainId, process.keyword])
      const group = groups.get(key) ?? {
        domainId,
        direction: process.direction ?? '专利检索',
        keyword: process.keyword,
        pages: new Map(),
      }
      group.pages.set(process.page ?? 1, event)
      groups.set(key, group)
      if (process.completed != null) discovered = process.completed
      if (process.outcome === 'failed' || process.outcome === 'stopped')
        notices.set(`issue:${event.sequence}`, event)
    } else if (process) {
      // Keep search-condition generation separate from detail acquisition.
      const key = `${event.node}:${process.stage}:${process.publicationNumber ?? ''}:${process.outcome}`
      notices.set(key, event)
    }
    if (
      event.acquisition?.stage === 'search' &&
      event.acquisition.completed != null
    )
      discovered = event.acquisition.completed
    if (event.acquisition?.stage === 'patents') {
      details = mergeDetails(details, event.acquisition)
      detailSequence = event.sequence
    }
  }
  if (
    run.acquisition?.stage === 'search' &&
    run.sequence >= (events[events.length - 1]?.sequence ?? 0)
  )
    discovered = run.acquisition.completed ?? discovered
  if (run.acquisition?.stage === 'patents' && run.sequence >= detailSequence)
    details = mergeDetails(details, run.acquisition)
  return {
    groups: [...groups.values()].map((group) => {
      const latest = [...group.pages.values()].sort(
        (a, b) => b.sequence - a.sequence
      )[0]?.process
      const finishReason = latest?.finishReason
      return {
        ...group,
        finishReason,
        status:
          finishReason === 'failed'
            ? 'failed'
            : finishReason
              ? 'completed'
              : latest?.outcome === 'stopped'
                ? 'stopped'
                : latest
                  ? 'running'
                  : 'pending',
      }
    }),
    notices: [...notices.values()],
    discovered: details?.total ?? discovered,
    details,
    completedPages: [...groups.values()].reduce(
      (sum, group) =>
        sum +
        [...group.pages.values()].filter(
          (e) => e.process?.outcome === 'completed'
        ).length,
      0
    ),
  }
}
