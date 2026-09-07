import { createHash } from 'node:crypto'
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import * as c from '@tech-scout/contracts'
import { sql } from 'kysely'
import { CatalogDatabase } from './catalog.database.js'

type Row = Record<string, unknown>
type Snapshot = Record<string, Row[]>
const text = (v: unknown) => (typeof v === 'string' ? v : null)
const number = (v: unknown) => (typeof v === 'number' ? v : null)
const id = (v: unknown) => String(v ?? '')
const contains = (v: unknown, q?: string) =>
  !q || id(v).toLowerCase().includes(q.toLowerCase())
const page = <T>(items: T[], q: c.CatalogPageQuery) => ({
  items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
  page: q.page,
  pageSize: q.pageSize,
  total: items.length,
  totalPages: Math.ceil(items.length / q.pageSize),
})
const find = (rows: Row[], key: string, value: string) => {
  const result = rows.find((r) => r[key] === value)
  if (!result) throw new NotFoundException('当前采集目录没有该记录')
  return result
}

// Reads immutable collection releases. No acquisition is triggered by catalog browsing.
@Injectable()
export class BrowserCatalogRepository {
  constructor(private readonly database: CatalogDatabase) {}
  private async load() {
    const result = await sql<{
      snapshot: Record<string, unknown>
    }>`SELECT snapshot FROM catalog_v2.release ORDER BY published_at DESC, release_id DESC LIMIT 1`.execute(
      this.database.withoutPlugins()
    )
    const raw = result.rows[0]?.snapshot
    if (!raw)
      throw new ServiceUnavailableException({
        code: 'CATALOG_UNAVAILABLE',
        message: '尚无采集数据，请先创建研究并确认检索；无需预先导入数据',
      })
    const s = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => Array.isArray(v))
    ) as Snapshot
    const r = raw.release as Row
    const release = c.catalogReleaseSchema.parse({
      releaseId: r.release_id,
      dataset: r.dataset,
      generatedAt: new Date(id(r.published_at)).toISOString(),
      publishedAt: new Date(id(r.published_at)).toISOString(),
      periodFromYear: r.period_from_year,
      periodToYear: r.period_to_year,
      unavailableFields: [],
    })
    return { s, release }
  }
  async currentRelease() {
    return (await this.load()).release
  }
  private source(row: Row, release: c.CatalogRelease) {
    return {
      locator: createHash('sha256').update(id(row.source_path)).digest('hex'),
      dataset: release.dataset,
      relativePath: text(row.source_path),
      sourceRowNumber: null,
      sha256: row.source_sha256,
      sourceRelease: row.source_release ?? release.releaseId,
      url: text(row.source_url),
    }
  }
  private domains(s: Snapshot) {
    return s.domains.map((d) => {
      const patents = new Set(
        s['patent-domain-matches']
          .filter((m) => m.domain_id === d.domain_id)
          .map((m) => m.patent_id)
      )
      return {
        domainId: id(d.domain_id),
        name: id(d.name),
        ruleVersion: id(d.rule_version),
        definition: d.definition,
        patentCount: patents.size,
        companyCount: new Set(
          s['company-patent-relations']
            .filter((r) => patents.has(r.patent_id))
            .map((r) => r.company_id)
        ).size,
      }
    })
  }
  async listDomains() {
    const { s, release } = await this.load()
    return { release, items: this.domains(s) }
  }
  async domainDetail(domainId: string) {
    const { s, release } = await this.load()
    const domain = this.domains(s).find((d) => d.domainId === domainId)
    if (!domain) throw new NotFoundException('技术方向不存在')
    const ids = new Set(
      s['patent-domain-matches']
        .filter((m) => m.domain_id === domainId)
        .map((m) => m.patent_id)
    )
    const years = new Map<number, Set<unknown>>(),
      cpcs = new Map<string, Set<unknown>>()
    for (const p of s.patents.filter((p) => ids.has(p.patent_id))) {
      const y = number(p.publication_year)
      if (y !== null) years.set(y, (years.get(y) ?? new Set()).add(p.patent_id))
    }
    for (const p of s['patent-classifications'].filter((p) =>
      ids.has(p.patent_id)
    )) {
      const code = id(p.cpc_group)
      cpcs.set(code, (cpcs.get(code) ?? new Set()).add(p.patent_id))
    }
    return {
      release,
      domain: {
        ...domain,
        yearTrend: [...years]
          .sort(([a], [b]) => a - b)
          .map(([year, p]) => ({ year, patentCount: p.size })),
        cpcGroups: [...cpcs].map(([cpcGroup, p]) => ({
          cpcGroup,
          patentCount: p.size,
        })),
      },
    }
  }
  private patents(
    s: Snapshot,
    q: c.CatalogPatentListQuery,
    domainId?: string,
    companyId?: string
  ) {
    return s.patents
      .filter(
        (p) =>
          (!domainId ||
            s['patent-domain-matches'].some(
              (m) => m.domain_id === domainId && m.patent_id === p.patent_id
            )) &&
          (!companyId ||
            s['company-patent-relations'].some(
              (m) => m.company_id === companyId && m.patent_id === p.patent_id
            ))
      )
      .map((p) => ({
        patentId: id(p.patent_id),
        title: id(p.patent_title),
        patentDate: text(p.patent_date),
        publicationYear: number(p.publication_year),
        grantYear: number(p.grant_year),
        patentType: null,
        wipoKind: null,
        numClaims: null,
        withdrawn: null,
        totalScore: 1,
        cpcGroups: [
          ...new Set(
            s['patent-classifications']
              .filter((r) => r.patent_id === p.patent_id)
              .map((r) => id(r.cpc_group))
          ),
        ],
        assignees: [
          ...new Set(
            s['patent-parties']
              .filter((r) => r.patent_id === p.patent_id)
              .map((r) => id(r.party_name))
          ),
        ],
      }))
      .filter(
        (p) =>
          contains(p.title, q.title) &&
          (!q.partyName || p.assignees.some((n) => contains(n, q.partyName))) &&
          (!q.cpcPrefix ||
            p.cpcGroups.some((n) => n.startsWith(q.cpcPrefix!))) &&
          (!q.fromYear ||
            (p.publicationYear !== null && p.publicationYear >= q.fromYear)) &&
          (!q.toYear ||
            (p.publicationYear !== null && p.publicationYear <= q.toYear))
      )
      .sort((a, b) => {
        const key =
          q.sort === 'title'
            ? 'title'
            : q.sort === 'patentDate'
              ? 'patentDate'
              : 'patentId'
        return (
          (id(a[key]).localeCompare(id(b[key])) ||
            a.patentId.localeCompare(b.patentId)) * (q.order === 'asc' ? 1 : -1)
        )
      })
  }
  async listDomainPatents(domainId: string, q: c.CatalogPatentListQuery) {
    const { s, release } = await this.load()
    find(s.domains, 'domain_id', domainId)
    return { release, ...page(this.patents(s, q, domainId), q) }
  }
  async listCompanyPatents(
    companyId: string,
    q: c.CatalogCompanyPatentListQuery
  ) {
    const { s, release } = await this.load()
    find(s.companies, 'company_id', companyId)
    return { release, ...page(this.patents(s, q, q.domainId, companyId), q) }
  }
  async patentDetail(patentId: string) {
    const { s, release } = await this.load(),
      p = find(s.patents, 'patent_id', patentId)
    return c.catalogPatentDetailResponseSchema.parse({
      release,
      patent: {
        ...this.patents(s, c.catalogPatentListQuerySchema.parse({})).find(
          (p) => p.patentId === patentId
        ),
        abstract: p.abstract ?? null,
        claims: p.claims ?? null,
        description: p.description ?? null,
        classifications: s['patent-classifications']
          .filter((r) => r.patent_id === patentId)
          .map((r) => ({ cpcGroup: r.cpc_group, sequence: null })),
        parties: s['patent-parties']
          .filter((r) => r.patent_id === patentId)
          .map((r) => ({
            partyId: r.patent_party_id,
            role: r.party_role,
            name: r.party_name,
            country: r.country,
            sequence: null,
            isIndividual: false,
          })),
        domainMatches: s['patent-domain-matches']
          .filter((r) => r.patent_id === patentId)
          .map((r) => ({
            domainId: r.domain_id,
            domainName: s.domains.find((d) => d.domain_id === r.domain_id)
              ?.name,
            totalScore: 1,
            ruleVersion: 'browser-v1',
            matchedCpcs: [],
            matchedStrongKeywords: [],
            matchedGeneralKeywords: [],
          })),
        source: this.source(p, release),
      },
    })
  }
  private companies(
    s: Snapshot,
    q: c.CatalogCompanyListQuery,
    domainId?: string
  ) {
    const eligible = new Set(
      s['patent-domain-matches']
        .filter((m) => !domainId || m.domain_id === domainId)
        .map((m) => m.patent_id)
    )
    return s.companies
      .map((co) => {
        const ids = new Set(
          s['company-patent-relations']
            .filter(
              (r) =>
                r.company_id === co.company_id &&
                (!domainId || eligible.has(r.patent_id))
            )
            .map((r) => r.patent_id)
        )
        const dates = s.patents
          .filter((p) => ids.has(p.patent_id))
          .map((p) => text(p.patent_date))
          .filter((v): v is string => v !== null)
          .sort()
        return {
          companyId: id(co.company_id),
          preferredName: id(co.preferred_name),
          legalName: text(co.legal_name),
          country: text(co.country),
          provider: 'riskbird',
          entityStatus: null,
          patentCount: ids.size,
          latestPatentDate: dates.at(-1) ?? null,
        }
      })
      .filter(
        (co) =>
          (!domainId || co.patentCount > 0) &&
          contains(co.preferredName, q.query) &&
          (!q.country || q.country === co.country)
      )
      .sort((a, b) => {
        const n =
          q.sort === 'patentCount'
            ? a.patentCount - b.patentCount
            : q.sort === 'name'
              ? a.preferredName.localeCompare(b.preferredName)
              : id(a.latestPatentDate).localeCompare(id(b.latestPatentDate))
        return (
          (n || a.companyId.localeCompare(b.companyId)) *
          (q.order === 'asc' ? 1 : -1)
        )
      })
  }
  async listCompanies(q: c.CatalogCompanyListQuery) {
    const { s, release } = await this.load()
    return { release, ...page(this.companies(s, q), q) }
  }
  async listDomainCompanies(domainId: string, q: c.CatalogCompanyListQuery) {
    const { s, release } = await this.load()
    find(s.domains, 'domain_id', domainId)
    return { release, ...page(this.companies(s, q, domainId), q) }
  }
  async companyDetail(companyId: string) {
    const { s, release } = await this.load(),
      co = find(s.companies, 'company_id', companyId)
    const domainStats = this.domains(s)
      .map((d) => ({
        domainId: d.domainId,
        domainName: d.name,
        ...this.companies(
          s,
          c.catalogCompanyListQuerySchema.parse({}),
          d.domainId
        ).find((c) => c.companyId === companyId),
      }))
      .filter((d) => d.patentCount)
    return c.catalogCompanyDetailResponseSchema.parse({
      release,
      company: {
        ...this.companies(s, c.catalogCompanyListQuerySchema.parse({})).find(
          (c) => c.companyId === companyId
        ),
        businessInfo: co.business_info ?? {},
        aliases: s['company-aliases']
          .filter((r) => r.company_id === companyId)
          .map((r, i) => ({
            aliasId: String(i),
            name: r.alias_name,
            type: 'former_name',
            provider: 'riskbird',
          })),
        externalIdentifiers: s['external-identifiers']
          .filter((r) => r.company_id === companyId)
          .map((r, i) => ({
            identifierId: String(i),
            type: r.identifier_type,
            value: r.identifier_value,
            provider: 'riskbird',
          })),
        relationships: [],
        domainStats,
        acceptedMatches: [],
        source: this.source(co, release),
      },
    })
  }
  async candidateDetail(candidateId: string) {
    const { s, release } = await this.load(),
      r = find(s['company-candidates'], 'candidate_id', candidateId)
    return c.catalogCandidateDetailResponseSchema.parse({
      release,
      candidate: {
        candidateId,
        representativeName: r.representative_name,
        country: r.country,
        patentCount: r.patent_count,
        partyRowCount: r.patent_count,
        rawNameVariantCount: 1,
        decision: null,
        evidenceCount: s['entity-evidence'].filter(
          (e) => e.candidate_id === candidateId
        ).length,
        suggestions: s['entity-matches']
          .filter((m) => m.candidate_id === candidateId)
          .map((m, i) => ({
            matchId: String(i),
            suggestedCompanyId: m.suggested_company_id,
            suggestedName: m.suggested_name,
            provider: 'riskbird',
            matchMethod: m.match_method,
            similarityScore: null,
            decision: m.decision,
            decisionReason: m.decision_reason,
            accepted: m.is_accepted,
          })),
      },
    })
  }
  async candidateEvidence(candidateId: string, q: c.CatalogPageQuery) {
    const { s, release } = await this.load()
    find(s['company-candidates'], 'candidate_id', candidateId)
    return c.catalogEvidenceListSchema.parse({
      release,
      ...page(
        s['entity-evidence']
          .filter((e) => e.candidate_id === candidateId)
          .map((e) => ({
            evidenceId: e.evidence_id,
            candidateId,
            publisher: e.publisher,
            sourceType: 'browser',
            sourceUrl: e.source_url,
            observedAt: new Date(id(e.observed_at)).toISOString(),
            legalName: e.legal_name,
            country: e.country,
            identifierType: e.identifier_type,
            identifierValue: e.identifier_value,
            preserved: e.preserved,
            contentSha256: e.content_sha256,
            source: this.source(e, release),
          })),
        q
      ),
    })
  }
  async sourceDetail(locator: string) {
    const { s, release } = await this.load()
    const row = Object.values(s)
      .flat()
      .find((r) => r.source_path && this.source(r, release).locator === locator)
    if (!row) throw new NotFoundException('来源不存在')
    return c.catalogSourceResponseSchema.parse({
      release,
      source: this.source(row, release),
    })
  }
}
