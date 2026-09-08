import { Injectable, NotFoundException } from '@nestjs/common'
import {
  researchPlanSchema,
  researchSummaryViewSchema,
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
    /^https:\/\/(patents\.google\.com|(?:www\.)?riskbird\.com)\//.test(
      v.source_url
    )
      ? v.source_url
      : null,
  sha256: str(v.source_sha256),
})
export const evidenceView = (e: Record<string, unknown>) => ({
  id: String(e.evidence_id),
  publisher: str(e.publisher),
  observedAt: str(e.observed_at),
  legalName: str(e.legal_name),
  country: str(e.country),
  identifierType: str(e.identifier_type),
  identifierValue: str(e.identifier_value),
  preserved: e.preserved === true,
  contentHash: str(e.content_sha256),
  source: sourceView(e),
})
export const candidateView = (u: Record<string, unknown>) => ({
  id: String(u.candidate_id),
  name: String(u.name),
  country: str(u.country),
  status: String(u.status),
  needsReview: u.requires_confirmation === true,
  terminalExclusion: u.terminal_exclusion === true,
  decision:
    str(object(u.user_decision).action) ??
    str(object(u.catalog_decision).decision),
  patentCount: strings(u.patent_ids).length,
})
export function resultView(v: unknown) {
  const r = object(v)
  if (!r.release_id) throw new NotFoundException('研究结果尚未生成')
  return {
    releaseId: String(r.release_id),
    patentCount: num(r.patent_count) ?? 0,
    missing: strings(r.missing),
    emptyReason: str(r.empty_reason),
    unverifiedCount: rows(r.unverified).length,
    conflictCount: rows(r.conflicts).length,
    companies: rows(r.companies).map((c) => ({
      id: String(c.company_id),
      name: String(c.preferred_name),
      country: str(c.country),
      identity: String(c.identity),
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
        COALESCE(jsonb_array_length(r.state #> '{artifacts,unverified}'), 0) AS "candidateCount",
        r.state #> '{artifacts,result}' IS NOT NULL AS "hasResult",
        (SELECT COALESCE(jsonb_agg(u->'candidate_id'), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(r.state #> '{artifacts,unverified}', '[]'::jsonb)) u
         WHERE u->>'requires_confirmation' = 'true') AS pending
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
      pendingCandidateIds: strings(r.pending),
      candidateCount: r.candidateCount,
      hasResult: r.hasResult,
    })
  }

  async events(userId: string, id: string, after: number) {
    // Ownership check never loads the multi-megabyte run state.
    const owned = await this.prisma.researchRun.findFirst({
      where: { id, project: { userId } },
      select: { id: true },
    })
    if (!owned) throw new NotFoundException('研究运行不存在')
    return this.prisma.$queryRaw<
      Array<{
        sequence: number
        kind: string
        createdAt: string
        status: string
        node: string | null
        error: unknown
      }>
    >(Prisma.sql`
      SELECT e.sequence, e.kind, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
        e.data->>'status' AS status, e.data->>'node' AS node, e.data->'error' AS error
      FROM app.research_event e WHERE e.run_id = ${id}::uuid AND e.sequence > ${after}
      ORDER BY e.sequence ASC LIMIT 100`)
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

  async conflicts(userId: string, id: string, q: ResearchViewQuery) {
    const a = await this.artifacts(userId, id)
    const candidates = rows(object(a.snapshot)['company-candidates'])
    return pageOf(
      rows(object(a.result).conflicts).map((c) => ({
        candidateId: String(c.candidate_id),
        name: String(
          candidates.find((u) => u.candidate_id === c.candidate_id)
            ?.representative_name ?? c.candidate_id
        ),
        kind: String(c.kind),
        note: String(c.note ?? ''),
        identifierType: str(c.identifier_type),
        values: Object.fromEntries(
          Object.entries(object(c.values)).map(([key, value]) => [
            key,
            strings(value),
          ])
        ),
      })),
      q
    )
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

  async candidates(userId: string, id: string, q: ResearchViewQuery) {
    let items = rows((await this.artifacts(userId, id)).unverified)
    if (q.pending === 'true')
      items = items.filter((u) => u.requires_confirmation === true)
    return pageOf(items.map(candidateView), q)
  }

  async candidate(userId: string, id: string, candidateId: string) {
    const a = await this.artifacts(userId, id),
      s = object(a.snapshot)
    const u = rows(a.unverified).find((u) => u.candidate_id === candidateId)
    if (!u) throw new NotFoundException('本次研究中没有该待核验主体')
    const evidence = rows(s['entity-evidence']).filter(
      (e) => e.candidate_id === candidateId
    )
    const identifiers = rows(s['external-identifiers'])
    return {
      ...candidateView(u),
      evidence: evidence.map(evidenceView),
      reviewNote: str(object(u.catalog_decision).reviewer_note),
      companyOptions: rows(s.companies).map((c) => ({
        id: String(c.company_id),
        name: String(c.preferred_name),
        country: str(c.country),
        supportingEvidenceIds: evidence
          .filter(
            (e) =>
              identifiers.some(
                (i) =>
                  i.company_id === c.company_id &&
                  i.identifier_type === e.identifier_type &&
                  i.identifier_value === e.identifier_value
              ) ||
              (Boolean(e.legal_name) &&
                [c.legal_name, c.preferred_name].some(
                  (n) =>
                    String(n ?? '').toLowerCase() ===
                    String(e.legal_name).toLowerCase()
                ) &&
                Boolean(c.country) &&
                e.country === c.country)
          )
          .map((e) => String(e.evidence_id)),
      })),
    }
  }

  async company(userId: string, id: string, companyId: string) {
    const a = await this.artifacts(userId, id),
      s = object(a.snapshot)
    const c = rows(a.companies).find((c) => c.company_id === companyId)
    if (!c) throw new NotFoundException('本次研究中没有该主体')
    const relations = rows(c.relations),
      candidateIds = new Set(relations.map((r) => r.candidate_id))
    // User-confirmed identities keep their own evidence and candidate association.
    for (const u of rows(a.unverified))
      if (object(u.user_decision).company_id === companyId)
        candidateIds.add(u.candidate_id)
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
      relations: relations.map((r) => ({
        patentId: String(r.patent_id),
        method: String(r.match_method ?? r.relation_type ?? 'user_confirmed'),
        decision: str(r.entity_match_decision),
      })),
      evidence: rows(s['entity-evidence'])
        .filter((e) => candidateIds.has(e.candidate_id))
        .map(evidenceView),
      confirmations: rows(c.user_evidence).map((e) => ({
        actorId: String(e.actor_id),
        confirmedAt: String(e.confirmed_at),
        note: String(e.note ?? ''),
        evidenceIds: strings(e.evidence_ids),
      })),
    }
  }
}
