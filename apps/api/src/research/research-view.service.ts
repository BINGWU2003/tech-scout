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
import * as queries from './research.repository.js'

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
const identityName = (value: string) =>
  [...value.normalize('NFKC').toLowerCase()]
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .join('')
export const companyLeadRelations = (
  artifacts: Record<string, unknown>,
  companyId: string
) => {
  const snapshot = object(artifacts.snapshot)
  const company = rows(snapshot.companies).find(
    (item) => item.company_id === companyId
  )
  if (!company) return []
  const aliases = new Set(
    rows(snapshot['company-aliases'])
      .filter((item) => item.company_id === companyId)
      .map((item) => identityName(String(item.alias_name)))
  )
  const assignees = new Map(
    rows(artifacts.assignees).map((item) => [String(item.assignee_id), item])
  )
  const patentIds = new Set(
    rows(artifacts.patents).map((item) => String(item.patent_id))
  )
  return rows(snapshot['company-search-hits'])
    .filter((hit) => hit.company_id === companyId)
    .flatMap((hit) => {
      const assignee = assignees.get(String(hit.assignee_id))
      if (!assignee) return []
      const name = identityName(String(assignee.name))
      const basis =
        name === identityName(String(company.legal_name))
          ? ('legal_name' as const)
          : aliases.has(name)
            ? ('alias' as const)
            : ('search_hit' as const)
      return strings(assignee.patent_ids)
        .filter((patentId) => patentIds.has(patentId))
        .map((patentId) => ({
          patentId,
          assigneeName: String(assignee.name),
          basis,
        }))
    })
}
export function resultView(v: unknown) {
  const r = object(v)
  if (!r.release_id) throw new NotFoundException('研究结果尚未生成')
  return {
    releaseId: String(r.release_id),
    patentCount: num(r.patent_count) ?? 0,
    missing: strings(r.missing),
    emptyReason: str(r.empty_reason),
    patents: rows(r.patents).map((p) => ({
      id: String(p.patent_id),
      priority: String(p.priority),
      reason: String(p.reason),
    })),
    companies: rows(r.companies).map((c) => ({
      id: String(c.company_id),
      name: String(c.preferred_name),
      country: str(c.country),
      priority: String(c.priority),
      summary: String(c.summary),
      assigneeNames: [
        ...new Set(rows(c.relations).map((r) => String(r.assignee_name))),
      ],
      leadPatentCount: new Set(
        rows(c.relations).map((r) => String(r.patent_id))
      ).size,
      citationIds: strings(c.patent_ids),
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
  const years = new Map<number, { year: number; count: number }>()
  const classifications = new Map<string, number>()
  let unknownYearCount = 0,
    unclassifiedCount = 0
  for (const patent of patents) {
    const year = num(patent.publication_year)
    if (year == null) unknownYearCount++
    else {
      const bucket = years.get(year) ?? { year, count: 0 }
      bucket.count++
      years.set(year, bucket)
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
    years: [...years.values()].sort((a, b) => a.year - b.year),
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
    const found = await queries.runSummary(this.prisma, userId, id)
    const r = found[0]
    if (!r) throw new NotFoundException('研究运行不存在')
    const s = object(r.state),
      context = object(r.context)
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
      releaseId: str(r.snapshotReleaseId),
      sourceMode: 'browser',
      acquisition: r.acquisition ?? null,
      fromYear: num(context.period_from_year),
      toYear: num(context.period_to_year),
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
    const events = await queries.runEvents(this.prisma, id, after)
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
      const c = rows(object(a.snapshot).companies).find(
        (c) => c.company_id === q.companyId
      )
      if (!c) throw new NotFoundException('本次研究中没有该主体')
      const ids = new Set(
        companyLeadRelations(a, q.companyId).map((r) => r.patentId)
      )
      patents = patents.filter((p) => ids.has(String(p.patent_id)))
    }
    return pageOf(
      patents.map((p) => ({
        id: String(p.patent_id),
        title: String(p.patent_title),
        year: num(p.publication_year),
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

  async companyStats(userId: string, id: string) {
    const a = await this.artifacts(userId, id)
    const companies = rows(object(a.snapshot).companies)
    return {
      total: companies.length,
      ranking: companies
        .map((company) => ({
          id: String(company.company_id),
          name: String(company.preferred_name),
          patentCount: new Set(
            companyLeadRelations(a, String(company.company_id)).map(
              (r) => r.patentId
            )
          ).size,
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
      relations: companyLeadRelations(a, companyId),
    }
  }
}
