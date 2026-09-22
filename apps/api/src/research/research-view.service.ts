import { Injectable, NotFoundException } from '@nestjs/common'
import {
  researchPlanSchema,
  researchSummaryViewSchema,
  researchProcessSchema,
  researchReasoningSchema,
  researchAnswerSchema,
  type ResearchViewQuery,
} from '@tech-scout/contracts'
import { PrismaService } from '../database/prisma.service.js'
import { Prisma } from '../generated/prisma/client.js'

// These projections deliberately allowlist fields: never return the full artifacts
// or spread Catalog records into the browser protocol.
export const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
export const rows = (v: unknown) => (Array.isArray(v) ? v.map(object) : [])
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : null)
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
export const sourceView = (v: Record<string, unknown>) => ({
  url:
    typeof v.source_url === 'string' &&
    /^(?:https:\/\/patents\.google\.com|https:\/\/m\.tianyancha\.com)\//.test(
      v.source_url
    )
      ? v.source_url
      : null,
  sha256: str(v.source_sha256),
})
export const subjectResolutionView = (
  resolution: Record<string, unknown>,
  subjects: Record<string, unknown>[],
  companies: Record<string, unknown>[]
) => {
  const subject = subjects.find(
    (item) => item.assignee_id === resolution.assignee_id
  )
  const company = companies.find(
    (item) => item.company_id === resolution.company_id
  )
  return {
    id: String(resolution.assignee_id),
    name: String(subject?.name ?? resolution.assignee_id),
    status: resolution.status === 'matched' ? 'matched' : 'unresolved',
    confidence:
      resolution.confidence === 'high' || resolution.confidence === 'medium'
        ? resolution.confidence
        : null,
    companyId: str(resolution.company_id),
    companyName: company ? String(company.preferred_name) : null,
    patentCount: strings(subject?.patent_ids).length,
    candidateCount: rows(subject?.candidates).length,
    candidates: rows(subject?.candidates).map((candidate) => {
      const id = String(candidate.company_id)
      const company = companies.find((item) => item.company_id === id)
      return {
        id,
        name: String(candidate.legal_name ?? company?.preferred_name ?? id),
      }
    }),
    reason: String(resolution.reason ?? ''),
  }
}
export function resultView(v: unknown) {
  const r = object(v)
  if (!r.release_id) throw new NotFoundException('研究结果尚未生成')
  return {
    releaseId: String(r.release_id),
    patentCount: num(r.patent_count) ?? 0,
    missing: strings(r.missing),
    emptyReason: str(r.empty_reason),
    unresolvedSubjects: rows(r.unresolved_subjects).map((subject) => ({
      id: String(subject.assignee_id),
      name: String(subject.name),
      patentCount: strings(subject.patent_ids).length,
      representativePatentIds: strings(subject.patent_ids).slice(0, 5),
      reason: String(subject.reason ?? '未找到可确认的企业主体'),
    })),
    warnings: strings(r.warnings),
    companies: rows(r.companies).map((c) => ({
      id: String(c.company_id),
      name: String(c.preferred_name),
      country: str(c.country),
      resolutionKind: 'agent_inferred' as const,
      confidence:
        c.confidence === 'high' ? ('high' as const) : ('medium' as const),
      assigneeNames: strings(c.assignee_names),
      resolutionReason: String(c.resolution_reason ?? ''),
      patentCount: num(c.patent_count) ?? 0,
      ruleScore: num(c.rule_score) ?? 0,
      trend: object(c.grant_year_trend),
      latestYear: num(c.latest_grant_year),
      explanation: str(object(c.inference).summary),
      citationIds: strings(object(c.inference).patent_ids),
    })),
  }
}
const pageOf = <T>(items: T[], q: ResearchViewQuery) => ({
  items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
  total: items.length,
  page: q.page,
  pageSize: q.pageSize,
})

export function patentStatsView(value: unknown) {
  const patents = rows(value)
  const years = new Map<
    string,
    { year: number; dateKind: 'publication' | 'grant'; count: number }
  >()
  const classifications = new Map<string, number>()
  let unknownYearCount = 0,
    unclassifiedCount = 0
  for (const patent of patents) {
    const publication = num(patent.publication_year)
    const year = publication ?? num(patent.grant_year)
    const dateKind = publication != null ? 'publication' : 'grant'
    if (year == null) unknownYearCount++
    else {
      const key = `${dateKind}:${year}`
      const bucket = years.get(key) ?? { year, dateKind, count: 0 }
      bucket.count++
      years.set(key, bucket)
    }
    // Count each patent once per subclass, even when multiple groups match.
    const codes = new Set(
      strings(patent.cpcs).flatMap((code) => {
        const subclass = code
          .trim()
          .toUpperCase()
          .match(/^[A-HY]\d{2}[A-Z]/)?.[0]
        return subclass ? [subclass] : []
      })
    )
    if (!codes.size) unclassifiedCount++
    for (const code of codes)
      classifications.set(code, (classifications.get(code) ?? 0) + 1)
  }
  return {
    total: patents.length,
    years: [...years.values()].sort(
      (a, b) => a.year - b.year || a.dateKind.localeCompare(b.dateKind)
    ),
    unknownYearCount,
    classifications: [...classifications]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    unclassifiedCount,
  }
}

@Injectable()
export class ResearchViewService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string, id: string) {
    const found = await this.prisma.$queryRaw<
      Record<string, unknown>[]
    >(Prisma.sql`
      SELECT r.id, r.project_id AS "projectId", r.question, r.status, r.sequence,
        r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.state - 'artifacts' AS state,
        r.state #> '{artifacts,context}' AS context,
        r.state #> '{artifacts,acquisition}' AS acquisition,
        r.state #>> '{artifacts,snapshot,release,release_id}' AS "snapshotReleaseId",
        r.state #> '{artifacts,plan}' AS plan, r.state #> '{artifacts,confirmed_plan}' AS confirmed,
        COALESCE(jsonb_array_length(r.state #> '{artifacts,assignees}'), 0) AS "queriedAssigneeCount",
        COALESCE(jsonb_array_length(r.state #> '{artifacts,snapshot,companies}'), 0) AS "discoveredCompanyCount",
        (SELECT count(*)::int FROM jsonb_array_elements(
          COALESCE(r.state #> '{artifacts,resolutions}', '[]'::jsonb)) x
          WHERE x->>'status' = 'matched') AS "resolvedSubjectCount",
        COALESCE(jsonb_array_length(r.state #> '{artifacts,unresolved}'), 0) AS "unresolvedSubjectCount",
        COALESCE(r.state #>> '{artifacts,result,workflow_version}',
          r.state #>> '{artifacts,execution_config,workflow_version}', 'browser-v2') AS "workflowVersion",
        r.state #> '{artifacts,result}' IS NOT NULL AS "hasResult",
        r.state #> '{artifacts,patents}' IS NOT NULL AS "hasPatents",
        r.state #> '{artifacts,subjects}' IS NOT NULL AS "hasCompanies"
      FROM app.research_run r JOIN app.research_project p ON p.id = r.project_id
      WHERE r.id = ${id}::uuid AND p.user_id = ${userId}::uuid`)
    const r = found[0]
    if (!r) throw new NotFoundException('研究运行不存在')
    const s = object(r.state),
      context = object(r.context),
      release = object(context.release)
    return researchSummaryViewSchema.parse({
      id: r.id,
      projectId: r.projectId,
      question: r.question,
      status: r.status,
      sequence: r.sequence,
      createdAt: (r.createdAt as Date).toISOString(),
      updatedAt: (r.updatedAt as Date).toISOString(),
      ready: Boolean(s.run_id),
      node: str(s.node),
      error: s.error ?? null,
      budget: s.budget ?? null,
      releaseId: str(r.snapshotReleaseId) ?? str(release.release_id),
      sourceMode: 'browser',
      acquisition: r.acquisition ?? null,
      fromYear: num(context.period_from_year) ?? num(release.period_from_year),
      toYear: num(context.period_to_year) ?? num(release.period_to_year),
      domains: rows(context.domains).map((d) => ({
        id: String(d.domain_id),
        name: String(d.name),
      })),
      plan: r.plan == null ? null : researchPlanSchema.parse(r.plan),
      confirmedPlan:
        r.confirmed == null ? null : researchPlanSchema.parse(r.confirmed),
      workflowVersion: r.workflowVersion,
      queriedAssigneeCount: r.queriedAssigneeCount,
      discoveredCompanyCount: r.discoveredCompanyCount,
      resolvedSubjectCount: r.resolvedSubjectCount,
      unresolvedSubjectCount: r.unresolvedSubjectCount,
      hasResult: r.hasResult,
      hasPatents: r.hasPatents ?? false,
      hasCompanies: r.hasCompanies ?? false,
    })
  }

  async events(userId: string, id: string, after: number) {
    // Ownership check never loads the multi-megabyte run state.
    const owned = await this.prisma.researchRun.findFirst({
      where: { id, project: { userId } },
      select: { id: true },
    })
    if (!owned) throw new NotFoundException('研究运行不存在')
    const events = await this.prisma.$queryRaw<
      Array<{
        sequence: number
        kind: string
        createdAt: string
        status: string
        node: string | null
        error: unknown
        process: unknown
        reasoning: unknown
        answer: unknown
        acquisition: unknown
      }>
    >(Prisma.sql`
      SELECT e.sequence, e.kind, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
        e.data->>'status' AS status, e.data->>'node' AS node, e.data->'error' AS error,
        CASE WHEN e.kind IN ('planner_progress', 'search_progress')
          THEN e.data #> '{artifacts,process}' END AS process,
        CASE WHEN e.kind = 'acquisition_progress'
          THEN e.data #> '{artifacts,acquisition}' END AS acquisition,
        CASE WHEN e.kind = 'reasoning_progress' OR e.data->>'status' NOT IN ('queued', 'running')
          THEN e.data #> '{artifacts,reasoning}' END AS reasoning,
        CASE WHEN e.kind = 'answer_progress' OR e.data->>'status' NOT IN ('queued', 'running')
          THEN e.data #> '{artifacts,answer}' END AS answer
      FROM app.research_event e WHERE e.run_id = ${id}::uuid AND e.sequence > ${after}
      ORDER BY e.sequence ASC LIMIT 100`)
    return events.map((event) => {
      const answer = researchAnswerSchema.nullable().parse(event.answer)
      if (
        answer?.status === 'streaming' &&
        !['queued', 'running'].includes(event.status)
      )
        answer.status = 'interrupted'
      const reasoning = researchReasoningSchema
        .nullable()
        .parse(event.reasoning)
      if (
        reasoning &&
        !['queued', 'running'].includes(event.status) &&
        ['thinking', 'answering'].includes(reasoning.status)
      )
        reasoning.status = 'interrupted'
      return {
        ...event,
        reasoning,
        answer,
        process: researchProcessSchema.safeParse(event.process).data ?? null,
        acquisition:
          researchSummaryViewSchema.shape.acquisition.safeParse(
            event.acquisition
          ).data ?? null,
      }
    })
  }

  private async artifacts(userId: string, id: string) {
    const r = await this.prisma.researchRun.findFirst({
      where: { id, project: { userId } },
      select: { state: true },
    })
    if (!r) throw new NotFoundException('研究运行不存在')
    return object(object(r.state).artifacts)
  }

  async result(userId: string, id: string) {
    return resultView((await this.artifacts(userId, id)).result)
  }

  async patents(userId: string, id: string, q: ResearchViewQuery) {
    const a = await this.artifacts(userId, id)
    let patents = rows(a.patents)
    if (q.patentId) patents = patents.filter((p) => p.patent_id === q.patentId)
    if (q.companyId) {
      const c = rows(a.companies).find((c) => c.company_id === q.companyId)
      if (!c) throw new NotFoundException('本次研究中没有该主体')
      const ids = new Set(strings(c.patent_ids))
      patents = patents.filter((p) => ids.has(String(p.patent_id)))
    }
    return pageOf(
      patents.map((p) => ({
        id: String(p.patent_id),
        title: String(p.patent_title),
        year: num(p.publication_year) ?? num(p.grant_year),
        dateKind:
          object(a.snapshot).source_mode === 'browser'
            ? 'publication'
            : 'grant',
        abstract: str(p.abstract),
        claims: q.patentId ? str(p.claims) : null,
        description: q.patentId ? str(p.description) : null,
        parties: rows(object(a.snapshot)['patent-parties'])
          .filter((x) => x.patent_id === p.patent_id)
          .map((x) => ({
            name: String(x.party_name),
            roles: strings(x.source_roles),
          })),
        cpcs: strings(p.cpcs),
        domains: [...new Set(rows(p.matches).map((m) => String(m.domain_id)))],
        source: sourceView(p),
      })),
      q
    )
  }

  async patentStats(userId: string, id: string) {
    return patentStatsView((await this.artifacts(userId, id)).patents)
  }

  async subjectResolutions(userId: string, id: string, q: ResearchViewQuery) {
    const a = await this.artifacts(userId, id)
    const subjects = rows(a.subjects)
    const companies = rows(object(a.snapshot).companies)
    return pageOf(
      rows(a.resolutions).map((resolution) =>
        subjectResolutionView(resolution, subjects, companies)
      ),
      q
    )
  }

  async companyStats(userId: string, id: string) {
    const a = await this.artifacts(userId, id)
    const companies = rows(object(a.snapshot).companies)
    return {
      total: companies.length,
      ranking: rows(a.companies)
        .map((company) => ({
          id: String(company.company_id),
          name: String(company.preferred_name),
          patentCount: new Set(strings(company.patent_ids)).size,
        }))
        .sort((left, right) => right.patentCount - left.patentCount)
        .slice(0, 8),
    }
  }

  async companyMatches(userId: string, id: string, q: ResearchViewQuery) {
    const a = await this.artifacts(userId, id)
    const snapshot = object(a.snapshot)
    const companies = rows(snapshot.companies)
    const hits = rows(snapshot['company-search-hits'])
    return pageOf(
      companies.map((company) => {
        const companyHits = hits.filter(
          (hit) => hit.company_id === company.company_id
        )
        return {
          id: String(company.company_id),
          name: String(company.preferred_name),
          country: str(company.country),
          queryNames: [
            ...new Set(companyHits.map((hit) => String(hit.query_name))),
          ],
          providerRank: companyHits.length
            ? Math.min(...companyHits.map((hit) => num(hit.provider_rank) ?? 0))
            : 0,
        }
      }),
      q
    )
  }

  async company(userId: string, id: string, companyId: string) {
    const a = await this.artifacts(userId, id),
      s = object(a.snapshot)
    const c = rows(s.companies).find(
      (company) => company.company_id === companyId
    )
    if (!c) throw new NotFoundException('本次研究中没有该主体')
    const resolved = rows(a.companies).find(
      (company) => company.company_id === companyId
    )
    const subjects = rows(a.subjects)
    const resolutions = rows(a.resolutions).filter(
      (resolution) => resolution.company_id === companyId
    )
    return {
      id: companyId,
      name: String(c.preferred_name),
      legalName: str(c.legal_name),
      country: str(c.country),
      source: sourceView(c),
      businessInfo: Object.fromEntries(
        Object.entries(object(c.business_info)).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      ),
      aliases: rows(s['company-aliases'])
        .filter((x) => x.company_id === companyId)
        .map((x) => String(x.alias_name ?? x.alias ?? '')),
      identifiers: rows(s['external-identifiers'])
        .filter((x) => x.company_id === companyId)
        .map((x) => ({
          type: String(x.identifier_type),
          value: String(x.identifier_value),
        })),
      relations: strings(resolved?.patent_ids).map((patentId) => ({
        patentId,
        method: 'agent_inferred',
        decision: 'matched',
      })),
      resolution: resolutions.length
        ? subjectResolutionView(resolutions[0], subjects, rows(s.companies))
        : null,
    }
  }
}
