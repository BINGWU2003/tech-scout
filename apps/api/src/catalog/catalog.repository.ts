import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type CatalogDomainList,
  type CatalogDomainDetailResponse,
  type CatalogCompanyList,
  type CatalogCompanyListQuery,
  type CatalogCompanyDetailResponse,
  type CatalogCompanyPatentListQuery,
  type CatalogCandidateDetailResponse,
  type CatalogEvidenceList,
  type CatalogPageQuery,
  type CatalogSourceResponse,
  type CatalogPatentList,
  type CatalogPatentListQuery,
  type CatalogPatentDetailResponse,
  type CatalogRelease,
} from '@tech-scout/contracts'
import { sql } from 'kysely'
import { type JsonValue } from '../generated/catalog.database.js'
import { decodeSourceLocator, sourceReference } from './catalog-source.js'
import { CatalogDatabase } from './catalog.database.js'

function unavailableFields(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((field): field is string => typeof field === 'string')
    : []
}

@Injectable()
export class CatalogRepository {
  constructor(private readonly database: CatalogDatabase) {}

  async currentRelease(): Promise<CatalogRelease> {
    const release = await this.database
      .selectFrom('datasetRelease')
      .select([
        'releaseId',
        'dataset',
        'generatedAt',
        'publishedAt',
        'periodFromYear',
        'periodToYear',
        'unavailableSourceFields',
      ])
      .where('releaseStatus', '=', 'published')
      .where('publishable', '=', true)
      .where('publishedAt', 'is not', null)
      .orderBy('publishedAt', 'desc')
      .orderBy('releaseId', 'desc')
      .executeTakeFirst()

    if (!release?.publishedAt) {
      throw new ServiceUnavailableException({
        code: 'CATALOG_UNAVAILABLE',
        message: '没有可用的已发布 Catalog 数据版本',
      })
    }

    return {
      releaseId: release.releaseId,
      dataset: release.dataset,
      generatedAt: new Date(release.generatedAt).toISOString(),
      publishedAt: new Date(release.publishedAt).toISOString(),
      periodFromYear: release.periodFromYear,
      periodToYear: release.periodToYear,
      unavailableFields: unavailableFields(release.unavailableSourceFields),
    }
  }

  async listDomains(): Promise<CatalogDomainList> {
    const release = await this.currentRelease()
    const matches = this.database
      .selectFrom('patentDomainMatch as match')
      .innerJoin('datasetRecord as record', (join) =>
        join
          .onRef('record.entityId', '=', 'match.domainMatchId')
          .on('record.entityType', '=', 'patent-domain-matches')
          .on('record.releaseId', '=', release.releaseId)
      )
      .select(['match.domainId', 'match.patentId'])
      .as('matches')
    const relations = this.database
      .selectFrom('companyPatentRelation as relation')
      .innerJoin('datasetRecord as record', (join) =>
        join
          .onRef('record.entityId', '=', 'relation.companyPatentRelationId')
          .on('record.entityType', '=', 'company-patent-relations')
          .on('record.releaseId', '=', release.releaseId)
      )
      .select(['relation.companyId', 'relation.patentId'])
      .as('relations')

    const rows = await this.database
      .selectFrom('domain as domain')
      .innerJoin('datasetRecord as domainRecord', (join) =>
        join
          .onRef('domainRecord.entityId', '=', 'domain.domainId')
          .on('domainRecord.entityType', '=', 'domains')
          .on('domainRecord.releaseId', '=', release.releaseId)
      )
      .leftJoin(matches, 'matches.domainId', 'domain.domainId')
      .leftJoin(relations, 'relations.patentId', 'matches.patentId')
      .select([
        'domain.domainId',
        'domain.name',
        'domain.ruleVersion',
        'domain.definition',
        sql<number>`count(distinct matches.patent_id)::integer`.as(
          'patentCount'
        ),
        sql<number>`count(distinct relations.company_id)::integer`.as(
          'companyCount'
        ),
      ])
      .groupBy('domain.domainId')
      .orderBy('domain.domainId')
      .execute()

    return { release, items: rows }
  }

  async domainDetail(domainId: string): Promise<CatalogDomainDetailResponse> {
    const domains = await this.listDomains()
    const domain = domains.items.find((item) => item.domainId === domainId)
    if (!domain) {
      throw new NotFoundException({
        code: 'DOMAIN_NOT_FOUND',
        message: '技术领域不存在',
      })
    }
    const releaseId = domains.release.releaseId
    const [yearTrend, cpcGroups] = await Promise.all([
      this.database
        .selectFrom('patent as patent')
        .innerJoin('datasetRecord as patentRecord', (join) =>
          join
            .onRef('patentRecord.entityId', '=', 'patent.patentId')
            .on('patentRecord.entityType', '=', 'patents')
            .on('patentRecord.releaseId', '=', releaseId)
        )
        .innerJoin('patentDomainMatch as match', (join) =>
          join
            .onRef('match.patentId', '=', 'patent.patentId')
            .on('match.domainId', '=', domainId)
        )
        .innerJoin('datasetRecord as matchRecord', (join) =>
          join
            .onRef('matchRecord.entityId', '=', 'match.domainMatchId')
            .on('matchRecord.entityType', '=', 'patent-domain-matches')
            .on('matchRecord.releaseId', '=', releaseId)
        )
        .select([
          'patent.grantYear as year',
          sql<number>`count(distinct patent.patent_id)::integer`.as(
            'patentCount'
          ),
        ])
        .groupBy('patent.grantYear')
        .orderBy('patent.grantYear')
        .execute(),
      this.database
        .selectFrom('patentClassification as classification')
        .innerJoin('datasetRecord as classificationRecord', (join) =>
          join
            .onRef(
              'classificationRecord.entityId',
              '=',
              'classification.classificationId'
            )
            .on(
              'classificationRecord.entityType',
              '=',
              'patent-classifications'
            )
            .on('classificationRecord.releaseId', '=', releaseId)
        )
        .innerJoin('patentDomainMatch as match', (join) =>
          join
            .onRef('match.patentId', '=', 'classification.patentId')
            .on('match.domainId', '=', domainId)
        )
        .innerJoin('datasetRecord as matchRecord', (join) =>
          join
            .onRef('matchRecord.entityId', '=', 'match.domainMatchId')
            .on('matchRecord.entityType', '=', 'patent-domain-matches')
            .on('matchRecord.releaseId', '=', releaseId)
        )
        .select([
          'classification.cpcGroup',
          sql<number>`count(distinct classification.patent_id)::integer`.as(
            'patentCount'
          ),
        ])
        .groupBy('classification.cpcGroup')
        .orderBy('patentCount', 'desc')
        .orderBy('classification.cpcGroup')
        .execute(),
    ])

    return {
      release: domains.release,
      domain: { ...domain, yearTrend, cpcGroups },
    }
  }

  async listDomainPatents(
    domainId: string,
    query: CatalogPatentListQuery
  ): Promise<CatalogPatentList> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(release.releaseId, 'domains', domainId, {
      code: 'DOMAIN_NOT_FOUND',
      message: '技术领域不存在',
    })

    const buildQuery = () => {
      let builder = this.database
        .selectFrom('patent as patent')
        .innerJoin('patentDomainMatch as match', (join) =>
          join
            .onRef('match.patentId', '=', 'patent.patentId')
            .on('match.domainId', '=', domainId)
        )
        .innerJoin('datasetRecord as patentRecord', (join) =>
          join
            .onRef('patentRecord.entityId', '=', 'patent.patentId')
            .on('patentRecord.entityType', '=', 'patents')
            .on('patentRecord.releaseId', '=', release.releaseId)
        )
        .innerJoin('datasetRecord as matchRecord', (join) =>
          join
            .onRef('matchRecord.entityId', '=', 'match.domainMatchId')
            .on('matchRecord.entityType', '=', 'patent-domain-matches')
            .on('matchRecord.releaseId', '=', release.releaseId)
        )

      if (query.title) {
        builder = builder.where(
          sql<boolean>`to_tsvector('simple', patent.patent_title) @@ websearch_to_tsquery('simple', ${query.title})`
        )
      }
      if (query.fromYear) {
        builder = builder.where('patent.grantYear', '>=', query.fromYear)
      }
      if (query.toYear) {
        builder = builder.where('patent.grantYear', '<=', query.toYear)
      }
      if (query.cpcPrefix) {
        builder = builder.where((expression) =>
          expression.exists(
            expression
              .selectFrom('patentClassification as classification')
              .innerJoin('datasetRecord as classificationRecord', (join) =>
                join
                  .onRef(
                    'classificationRecord.entityId',
                    '=',
                    'classification.classificationId'
                  )
                  .on(
                    'classificationRecord.entityType',
                    '=',
                    'patent-classifications'
                  )
                  .on('classificationRecord.releaseId', '=', release.releaseId)
              )
              .select('classification.classificationId')
              .whereRef('classification.patentId', '=', 'patent.patentId')
              .where('classification.cpcGroup', 'like', `${query.cpcPrefix}%`)
          )
        )
      }
      if (query.partyName) {
        const partyName = `%${query.partyName.toLowerCase()}%`
        builder = builder.where((expression) =>
          expression.exists(
            expression
              .selectFrom('patentParty as party')
              .innerJoin('datasetRecord as partyRecord', (join) =>
                join
                  .onRef('partyRecord.entityId', '=', 'party.patentPartyId')
                  .on('partyRecord.entityType', '=', 'patent-parties')
                  .on('partyRecord.releaseId', '=', release.releaseId)
              )
              .select('party.patentPartyId')
              .whereRef('party.patentId', '=', 'patent.patentId')
              .where('party.partyNameNormalized', 'ilike', partyName)
          )
        )
      }
      return builder
    }

    const count = await buildQuery()
      .select(sql<number>`count(*)::integer`.as('total'))
      .executeTakeFirstOrThrow()

    let itemsQuery = buildQuery().select([
      'patent.patentId',
      'patent.patentTitle as title',
      'patent.patentDate',
      'patent.grantYear',
      'patent.patentType',
      'patent.wipoKind',
      'patent.numClaims',
      'patent.withdrawn',
      'match.totalScore',
    ])
    if (query.sort === 'patentDate') {
      itemsQuery = itemsQuery
        .orderBy('patent.patentDate', query.order)
        .orderBy('match.totalScore', 'desc')
    } else if (query.sort === 'title') {
      itemsQuery = itemsQuery.orderBy('patent.patentTitle', query.order)
    } else {
      itemsQuery = itemsQuery
        .orderBy('match.totalScore', query.order)
        .orderBy('patent.patentDate', 'desc')
    }
    const rows = await itemsQuery
      .orderBy('patent.patentId')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .execute()

    const { classifications, parties } = await this.patentFacets(
      release.releaseId,
      rows.map((row) => row.patentId)
    )

    return {
      release,
      items: rows.map((row) => ({
        ...row,
        cpcGroups: classifications
          .filter((item) => item.patentId === row.patentId)
          .map((item) => item.cpcGroup),
        assignees: parties
          .filter((item) => item.patentId === row.patentId)
          .map((item) => item.partyName),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: count.total,
      totalPages: Math.ceil(count.total / query.pageSize),
    }
  }

  async patentDetail(patentId: string): Promise<CatalogPatentDetailResponse> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(release.releaseId, 'patents', patentId, {
      code: 'PATENT_NOT_FOUND',
      message: '专利不存在',
    })

    const patent = await this.database
      .selectFrom('patent')
      .selectAll()
      .where('patentId', '=', patentId)
      .executeTakeFirstOrThrow()
    const [classifications, parties, matches] = await Promise.all([
      this.database
        .selectFrom('patentClassification as classification')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'classification.classificationId')
            .on('record.entityType', '=', 'patent-classifications')
            .on('record.releaseId', '=', release.releaseId)
        )
        .select([
          'classification.cpcGroup',
          'classification.cpcSequence as sequence',
          'classification.cpcType as type',
          'classification.cpcActionDate as actionDate',
        ])
        .where('classification.patentId', '=', patentId)
        .orderBy('classification.cpcSequence')
        .orderBy('classification.cpcGroup')
        .execute(),
      this.database
        .selectFrom('patentParty as party')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'party.patentPartyId')
            .on('record.entityType', '=', 'patent-parties')
            .on('record.releaseId', '=', release.releaseId)
        )
        .select([
          'party.patentPartyId as partyId',
          'party.partyRole as role',
          'party.partyName as name',
          'party.country',
          'party.city',
          'party.region',
          'party.partySequence as sequence',
          'party.isIndividual',
        ])
        .where('party.patentId', '=', patentId)
        .orderBy('party.partySequence')
        .orderBy('party.partyName')
        .execute(),
      this.database
        .selectFrom('patentDomainMatch as match')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'match.domainMatchId')
            .on('record.entityType', '=', 'patent-domain-matches')
            .on('record.releaseId', '=', release.releaseId)
        )
        .innerJoin('domain', 'domain.domainId', 'match.domainId')
        .select([
          'match.domainId',
          'domain.name as domainName',
          'match.totalScore',
          'match.ruleVersion',
          'match.matchedCpcs',
          'match.matchedStrongKeywords',
          'match.matchedGeneralKeywords',
        ])
        .where('match.patentId', '=', patentId)
        .orderBy('match.totalScore', 'desc')
        .orderBy('match.domainId')
        .execute(),
    ])

    return {
      release,
      patent: {
        patentId: patent.patentId,
        title: patent.patentTitle,
        patentDate: patent.patentDate,
        grantYear: patent.grantYear,
        patentType: patent.patentType,
        wipoKind: patent.wipoKind,
        numClaims: patent.numClaims,
        withdrawn: patent.withdrawn,
        classifications,
        parties,
        domainMatches: matches.map((match) => ({
          ...match,
          matchedCpcs: stringArray(match.matchedCpcs),
          matchedStrongKeywords: stringArray(match.matchedStrongKeywords),
          matchedGeneralKeywords: stringArray(match.matchedGeneralKeywords),
        })),
        source: sourceReference({
          id: patent.patentId,
          dataset: 'patents',
          sourcePath: patent.sourcePath,
          sourceRowNumber: patent.sourceRowNumber,
          sourceSha256: patent.sourceSha256,
          sourceRelease: patent.sourceRelease,
        }),
      },
    }
  }

  async listDomainCompanies(
    domainId: string,
    query: CatalogCompanyListQuery
  ): Promise<CatalogCompanyList> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(release.releaseId, 'domains', domainId, {
      code: 'DOMAIN_NOT_FOUND',
      message: '技术领域不存在',
    })
    return this.listCompaniesForRelease(release, query, domainId)
  }

  async listCompanies(
    query: CatalogCompanyListQuery
  ): Promise<CatalogCompanyList> {
    const release = await this.currentRelease()
    return this.listCompaniesForRelease(release, query)
  }

  async companyDetail(
    companyId: string
  ): Promise<CatalogCompanyDetailResponse> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(release.releaseId, 'companies', companyId, {
      code: 'COMPANY_NOT_FOUND',
      message: '公司不存在',
    })
    const company = await this.database
      .selectFrom('companyEntity')
      .selectAll()
      .where('companyId', '=', companyId)
      .executeTakeFirstOrThrow()

    const [aliases, identifiers, outgoing, incoming, domainStats, matches] =
      await Promise.all([
        this.database
          .selectFrom('companyAlias as alias')
          .innerJoin('datasetRecord as record', (join) =>
            join
              .onRef('record.entityId', '=', 'alias.aliasId')
              .on('record.entityType', '=', 'company-aliases')
              .on('record.releaseId', '=', release.releaseId)
          )
          .select([
            'alias.aliasId',
            'alias.aliasName as name',
            'alias.aliasType as type',
            'alias.sourceProvider as provider',
          ])
          .where('alias.companyId', '=', companyId)
          .orderBy('alias.aliasType')
          .orderBy('alias.aliasName')
          .execute(),
        this.database
          .selectFrom('externalIdentifier as identifier')
          .innerJoin('datasetRecord as record', (join) =>
            join
              .onRef('record.entityId', '=', 'identifier.externalIdentifierId')
              .on('record.entityType', '=', 'external-identifiers')
              .on('record.releaseId', '=', release.releaseId)
          )
          .select([
            'identifier.externalIdentifierId as identifierId',
            'identifier.identifierType as type',
            'identifier.identifierValue as value',
            'identifier.provider',
          ])
          .where('identifier.companyId', '=', companyId)
          .orderBy('identifier.identifierType')
          .orderBy('identifier.identifierValue')
          .execute(),
        this.companyRelationships(release.releaseId, companyId, 'outgoing'),
        this.companyRelationships(release.releaseId, companyId, 'incoming'),
        this.database
          .selectFrom('companyPatentRelation as relation')
          .innerJoin('datasetRecord as relationRecord', (join) =>
            join
              .onRef(
                'relationRecord.entityId',
                '=',
                'relation.companyPatentRelationId'
              )
              .on('relationRecord.entityType', '=', 'company-patent-relations')
              .on('relationRecord.releaseId', '=', release.releaseId)
          )
          .innerJoin('patent', 'patent.patentId', 'relation.patentId')
          .innerJoin('patentDomainMatch as match', (join) =>
            join.onRef('match.patentId', '=', 'patent.patentId')
          )
          .innerJoin('datasetRecord as matchRecord', (join) =>
            join
              .onRef('matchRecord.entityId', '=', 'match.domainMatchId')
              .on('matchRecord.entityType', '=', 'patent-domain-matches')
              .on('matchRecord.releaseId', '=', release.releaseId)
          )
          .innerJoin('domain', 'domain.domainId', 'match.domainId')
          .select([
            'domain.domainId',
            'domain.name as domainName',
            sql<number>`count(distinct patent.patent_id)::integer`.as(
              'patentCount'
            ),
            sql<string>`max(patent.patent_date)`.as('latestPatentDate'),
          ])
          .where('relation.companyId', '=', companyId)
          .groupBy(['domain.domainId', 'domain.name'])
          .orderBy('patentCount', 'desc')
          .orderBy('domain.domainId')
          .execute(),
        this.database
          .selectFrom('entityMatch as match')
          .innerJoin('datasetRecord as matchRecord', (join) =>
            join
              .onRef('matchRecord.entityId', '=', 'match.entityMatchId')
              .on('matchRecord.entityType', '=', 'entity-matches')
              .on('matchRecord.releaseId', '=', release.releaseId)
          )
          .innerJoin(
            'companyCandidate as candidate',
            'candidate.candidateId',
            'match.candidateId'
          )
          .select([
            'candidate.candidateId',
            'candidate.representativeName',
            'candidate.country',
            sql<number>`candidate.patent_count::integer`.as('patentCount'),
            'match.matchMethod',
            'match.similarityScore',
            'match.decision',
            'match.decisionReason',
            'match.ruleVersion',
          ])
          .where('match.suggestedCompanyId', '=', companyId)
          .where('match.isAccepted', '=', true)
          .orderBy('candidate.patentCount', 'desc')
          .orderBy('candidate.candidateId')
          .execute(),
      ])

    return {
      release,
      company: {
        companyId: company.companyId,
        preferredName: company.preferredName,
        legalName: company.legalName,
        country: company.country,
        provider: company.provider,
        entityStatus: company.entityStatus,
        aliases,
        externalIdentifiers: identifiers,
        relationships: [...outgoing, ...incoming],
        domainStats,
        acceptedMatches: matches,
        source: sourceReference({
          id: company.companyId,
          dataset: 'companies',
          sourcePath: company.sourcePath,
          sourceRowNumber: company.sourceRowNumber,
          sourceSha256: company.sourceSha256,
          sourceRelease: company.sourceRelease,
        }),
      },
    }
  }

  async listCompanyPatents(
    companyId: string,
    query: CatalogCompanyPatentListQuery
  ): Promise<CatalogPatentList> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(release.releaseId, 'companies', companyId, {
      code: 'COMPANY_NOT_FOUND',
      message: '公司不存在',
    })
    if (query.domainId) {
      await this.assertCurrentRecord(
        release.releaseId,
        'domains',
        query.domainId,
        { code: 'DOMAIN_NOT_FOUND', message: '技术领域不存在' }
      )
    }

    const buildQuery = () => {
      let builder = this.database
        .selectFrom('companyPatentRelation as relation')
        .innerJoin('datasetRecord as relationRecord', (join) =>
          join
            .onRef(
              'relationRecord.entityId',
              '=',
              'relation.companyPatentRelationId'
            )
            .on('relationRecord.entityType', '=', 'company-patent-relations')
            .on('relationRecord.releaseId', '=', release.releaseId)
        )
        .innerJoin('patent', 'patent.patentId', 'relation.patentId')
        .innerJoin('datasetRecord as patentRecord', (join) =>
          join
            .onRef('patentRecord.entityId', '=', 'patent.patentId')
            .on('patentRecord.entityType', '=', 'patents')
            .on('patentRecord.releaseId', '=', release.releaseId)
        )
        .innerJoin('patentDomainMatch as match', (join) =>
          join.onRef('match.patentId', '=', 'patent.patentId')
        )
        .innerJoin('datasetRecord as matchRecord', (join) =>
          join
            .onRef('matchRecord.entityId', '=', 'match.domainMatchId')
            .on('matchRecord.entityType', '=', 'patent-domain-matches')
            .on('matchRecord.releaseId', '=', release.releaseId)
        )
        .where('relation.companyId', '=', companyId)

      if (query.domainId) {
        builder = builder.where('match.domainId', '=', query.domainId)
      }
      if (query.title) {
        builder = builder.where(
          sql<boolean>`to_tsvector('simple', patent.patent_title) @@ websearch_to_tsquery('simple', ${query.title})`
        )
      }
      if (query.fromYear) {
        builder = builder.where('patent.grantYear', '>=', query.fromYear)
      }
      if (query.toYear) {
        builder = builder.where('patent.grantYear', '<=', query.toYear)
      }
      if (query.cpcPrefix) {
        builder = builder.where((expression) =>
          expression.exists(
            expression
              .selectFrom('patentClassification as classification')
              .select('classification.classificationId')
              .whereRef('classification.patentId', '=', 'patent.patentId')
              .where('classification.cpcGroup', 'like', `${query.cpcPrefix}%`)
          )
        )
      }
      if (query.partyName) {
        const partyName = `%${query.partyName.toLowerCase()}%`
        builder = builder.where((expression) =>
          expression.exists(
            expression
              .selectFrom('patentParty as party')
              .select('party.patentPartyId')
              .whereRef('party.patentId', '=', 'patent.patentId')
              .where('party.partyNameNormalized', 'ilike', partyName)
          )
        )
      }
      return builder
    }

    const count = await buildQuery()
      .select(
        sql<number>`count(distinct patent.patent_id)::integer`.as('total')
      )
      .executeTakeFirstOrThrow()
    let itemsQuery = buildQuery()
      .select([
        'patent.patentId',
        'patent.patentTitle as title',
        'patent.patentDate',
        'patent.grantYear',
        'patent.patentType',
        'patent.wipoKind',
        'patent.numClaims',
        'patent.withdrawn',
        sql<number>`max(match.total_score)::integer`.as('totalScore'),
      ])
      .groupBy('patent.patentId')

    if (query.sort === 'patentDate') {
      itemsQuery = itemsQuery.orderBy('patent.patentDate', query.order)
    } else if (query.sort === 'title') {
      itemsQuery = itemsQuery.orderBy('patent.patentTitle', query.order)
    } else {
      itemsQuery = itemsQuery.orderBy('totalScore', query.order)
    }
    const rows = await itemsQuery
      .orderBy('patent.patentDate', 'desc')
      .orderBy('patent.patentId')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .execute()
    const { classifications, parties } = await this.patentFacets(
      release.releaseId,
      rows.map((row) => row.patentId)
    )

    return {
      release,
      items: rows.map((row) => ({
        ...row,
        cpcGroups: classifications
          .filter((item) => item.patentId === row.patentId)
          .map((item) => item.cpcGroup),
        assignees: parties
          .filter((item) => item.patentId === row.patentId)
          .map((item) => item.partyName),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: count.total,
      totalPages: Math.ceil(count.total / query.pageSize),
    }
  }

  async candidateDetail(
    candidateId: string
  ): Promise<CatalogCandidateDetailResponse> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(
      release.releaseId,
      'company-candidates',
      candidateId,
      { code: 'CANDIDATE_NOT_FOUND', message: '公司候选不存在' }
    )
    const candidate = await this.database
      .selectFrom('companyCandidate')
      .selectAll()
      .where('candidateId', '=', candidateId)
      .executeTakeFirstOrThrow()
    const [decision, suggestions, evidenceCount] = await Promise.all([
      this.database
        .selectFrom('entityReviewDecision as decision')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'decision.candidateId')
            .on('record.entityType', '=', 'entity-review-decisions')
            .on('record.releaseId', '=', release.releaseId)
        )
        .select([
          'decision.decision as value',
          'decision.organizationType',
          'decision.selectedCompanyId',
          'decision.reviewMethod',
          'decision.reviewedAt',
          'decision.reviewer',
          'decision.reviewerNote as note',
        ])
        .where('decision.candidateId', '=', candidateId)
        .executeTakeFirst(),
      this.database
        .selectFrom('entityMatch as match')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'match.entityMatchId')
            .on('record.entityType', '=', 'entity-matches')
            .on('record.releaseId', '=', release.releaseId)
        )
        .select([
          'match.entityMatchId as matchId',
          'match.suggestedCompanyId',
          'match.suggestedName',
          'match.provider',
          'match.matchMethod',
          'match.similarityScore',
          'match.decision',
          'match.decisionReason',
          'match.isAccepted as accepted',
        ])
        .where('match.candidateId', '=', candidateId)
        .orderBy('match.suggestionRank')
        .orderBy('match.entityMatchId')
        .execute(),
      this.database
        .selectFrom('entityEvidence as evidence')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'evidence.evidenceId')
            .on('record.entityType', '=', 'entity-evidence')
            .on('record.releaseId', '=', release.releaseId)
        )
        .select(sql<number>`count(*)::integer`.as('total'))
        .where('evidence.candidateId', '=', candidateId)
        .executeTakeFirstOrThrow(),
    ])

    return {
      release,
      candidate: {
        candidateId: candidate.candidateId,
        representativeName: candidate.representativeName,
        country: candidate.country,
        patentCount: Number(candidate.patentCount),
        partyRowCount: Number(candidate.partyRowCount),
        rawNameVariantCount: candidate.rawNameVariantCount,
        decision: decision
          ? {
              ...decision,
              reviewedAt: decision.reviewedAt
                ? new Date(decision.reviewedAt).toISOString()
                : null,
            }
          : null,
        suggestions,
        evidenceCount: evidenceCount.total,
      },
    }
  }

  async candidateEvidence(
    candidateId: string,
    query: CatalogPageQuery
  ): Promise<CatalogEvidenceList> {
    const release = await this.currentRelease()
    await this.assertCurrentRecord(
      release.releaseId,
      'company-candidates',
      candidateId,
      { code: 'CANDIDATE_NOT_FOUND', message: '公司候选不存在' }
    )
    const baseQuery = () =>
      this.database
        .selectFrom('entityEvidence as evidence')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'evidence.evidenceId')
            .on('record.entityType', '=', 'entity-evidence')
            .on('record.releaseId', '=', release.releaseId)
        )
        .where('evidence.candidateId', '=', candidateId)

    const count = await baseQuery()
      .select(sql<number>`count(*)::integer`.as('total'))
      .executeTakeFirstOrThrow()
    const rows = await baseQuery()
      .select([
        'evidence.evidenceId',
        'evidence.candidateId',
        'evidence.publisher',
        'evidence.sourceType',
        'evidence.sourceUrl',
        'evidence.observedAt',
        'evidence.legalName',
        'evidence.country',
        'evidence.identifierType',
        'evidence.identifierValue',
        'evidence.preserved',
        'evidence.contentSha256',
        'evidence.sourcePath',
        'evidence.sourceRowNumber',
        'evidence.sourceSha256',
        'evidence.sourceRelease',
      ])
      .orderBy('evidence.observedAt', 'desc')
      .orderBy('evidence.evidenceId')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .execute()

    return {
      release,
      items: rows.map((row) => ({
        evidenceId: row.evidenceId,
        candidateId: row.candidateId,
        publisher: row.publisher,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
        observedAt: new Date(row.observedAt).toISOString(),
        legalName: row.legalName,
        country: row.country,
        identifierType: row.identifierType,
        identifierValue: row.identifierValue,
        preserved: row.preserved,
        contentSha256: row.contentSha256?.trim() ?? null,
        source: sourceReference({
          id: row.evidenceId,
          dataset: 'entity-evidence',
          sourcePath: row.sourcePath,
          sourceRowNumber: row.sourceRowNumber,
          sourceSha256: row.sourceSha256,
          sourceRelease: row.sourceRelease,
          url: row.sourceUrl,
        }),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: count.total,
      totalPages: Math.ceil(count.total / query.pageSize),
    }
  }

  async sourceDetail(locator: string): Promise<CatalogSourceResponse> {
    const release = await this.currentRelease()
    const decoded = decodeSourceLocator(locator)
    if (!decoded) this.sourceNotFound()

    let source
    if (decoded.dataset === 'patents') {
      await this.assertCurrentRecord(release.releaseId, 'patents', decoded.id, {
        code: 'SOURCE_NOT_FOUND',
        message: '来源不存在',
      })
      const row = await this.database
        .selectFrom('patent')
        .select([
          'patentId as id',
          'sourcePath',
          'sourceRowNumber',
          'sourceSha256',
          'sourceRelease',
        ])
        .where('patentId', '=', decoded.id)
        .executeTakeFirstOrThrow()
      source = sourceReference({ ...row, dataset: decoded.dataset })
    } else if (decoded.dataset === 'companies') {
      await this.assertCurrentRecord(
        release.releaseId,
        'companies',
        decoded.id,
        {
          code: 'SOURCE_NOT_FOUND',
          message: '来源不存在',
        }
      )
      const row = await this.database
        .selectFrom('companyEntity')
        .select([
          'companyId as id',
          'sourcePath',
          'sourceRowNumber',
          'sourceSha256',
          'sourceRelease',
        ])
        .where('companyId', '=', decoded.id)
        .executeTakeFirstOrThrow()
      source = sourceReference({ ...row, dataset: decoded.dataset })
    } else if (decoded.dataset === 'company-relations') {
      await this.assertCurrentRecord(
        release.releaseId,
        'company-relations',
        decoded.id,
        { code: 'SOURCE_NOT_FOUND', message: '来源不存在' }
      )
      const row = await this.database
        .selectFrom('companyRelation')
        .select([
          'companyRelationId as id',
          'sourcePath',
          'sourceRowNumber',
          'sourceSha256',
          'sourceRelease',
        ])
        .where('companyRelationId', '=', decoded.id)
        .executeTakeFirstOrThrow()
      source = sourceReference({ ...row, dataset: decoded.dataset })
    } else if (decoded.dataset === 'entity-evidence') {
      await this.assertCurrentRecord(
        release.releaseId,
        'entity-evidence',
        decoded.id,
        { code: 'SOURCE_NOT_FOUND', message: '来源不存在' }
      )
      const row = await this.database
        .selectFrom('entityEvidence')
        .select([
          'evidenceId as id',
          'sourcePath',
          'sourceRowNumber',
          'sourceSha256',
          'sourceRelease',
          'sourceUrl as url',
        ])
        .where('evidenceId', '=', decoded.id)
        .executeTakeFirstOrThrow()
      source = sourceReference({ ...row, dataset: decoded.dataset })
    } else {
      this.sourceNotFound()
    }

    return { release, source }
  }

  private sourceNotFound(): never {
    throw new NotFoundException({
      code: 'SOURCE_NOT_FOUND',
      message: '来源不存在',
    })
  }

  private async patentFacets(releaseId: string, patentIds: string[]) {
    if (patentIds.length === 0) return { classifications: [], parties: [] }
    const [classifications, parties] = await Promise.all([
      this.database
        .selectFrom('patentClassification as classification')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'classification.classificationId')
            .on('record.entityType', '=', 'patent-classifications')
            .on('record.releaseId', '=', releaseId)
        )
        .select(['classification.patentId', 'classification.cpcGroup'])
        .where('classification.patentId', 'in', patentIds)
        .orderBy('classification.cpcGroup')
        .execute(),
      this.database
        .selectFrom('patentParty as party')
        .innerJoin('datasetRecord as record', (join) =>
          join
            .onRef('record.entityId', '=', 'party.patentPartyId')
            .on('record.entityType', '=', 'patent-parties')
            .on('record.releaseId', '=', releaseId)
        )
        .select(['party.patentId', 'party.partyName'])
        .where('party.patentId', 'in', patentIds)
        .where('party.partyRole', '=', 'assignee')
        .orderBy('party.partySequence')
        .execute(),
    ])
    return { classifications, parties }
  }

  private async companyRelationships(
    releaseId: string,
    companyId: string,
    direction: 'outgoing' | 'incoming'
  ) {
    const ownColumn =
      direction === 'outgoing'
        ? 'relation.startCompanyId'
        : 'relation.endCompanyId'
    const relatedColumn =
      direction === 'outgoing'
        ? 'relation.endCompanyId'
        : 'relation.startCompanyId'
    const rows = await this.database
      .selectFrom('companyRelation as relation')
      .innerJoin('datasetRecord as record', (join) =>
        join
          .onRef('record.entityId', '=', 'relation.companyRelationId')
          .on('record.entityType', '=', 'company-relations')
          .on('record.releaseId', '=', releaseId)
      )
      .innerJoin('companyEntity as related', relatedColumn, 'related.companyId')
      .select([
        'relation.companyRelationId as relationshipId',
        'related.companyId',
        'related.preferredName',
        'related.country',
        'relation.relationshipType',
        'relation.relationshipStatus',
        'relation.periodStartDate',
        'relation.periodEndDate',
        'relation.periodType',
        'relation.sourcePath',
        'relation.sourceRowNumber',
        'relation.sourceSha256',
        'relation.sourceRelease',
      ])
      .where(ownColumn, '=', companyId)
      .orderBy('relation.relationshipType')
      .orderBy('related.companyId')
      .execute()

    return rows.map((row) => ({
      relationshipId: row.relationshipId,
      direction,
      relatedCompany: {
        companyId: row.companyId,
        preferredName: row.preferredName,
        country: row.country,
      },
      relationshipType: row.relationshipType,
      relationshipStatus: row.relationshipStatus,
      periodStartDate: row.periodStartDate,
      periodEndDate: row.periodEndDate,
      periodType: row.periodType,
      source: sourceReference({
        id: row.relationshipId,
        dataset: 'company-relations',
        sourcePath: row.sourcePath,
        sourceRowNumber: row.sourceRowNumber,
        sourceSha256: row.sourceSha256,
        sourceRelease: row.sourceRelease,
      }),
    }))
  }

  private async listCompaniesForRelease(
    release: CatalogRelease,
    query: CatalogCompanyListQuery,
    domainId?: string
  ): Promise<CatalogCompanyList> {
    const buildQuery = () => {
      let builder = this.database
        .selectFrom('companyEntity as company')
        .innerJoin('datasetRecord as companyRecord', (join) =>
          join
            .onRef('companyRecord.entityId', '=', 'company.companyId')
            .on('companyRecord.entityType', '=', 'companies')
            .on('companyRecord.releaseId', '=', release.releaseId)
        )
        .innerJoin('companyPatentRelation as relation', (join) =>
          join.onRef('relation.companyId', '=', 'company.companyId')
        )
        .innerJoin('datasetRecord as relationRecord', (join) =>
          join
            .onRef(
              'relationRecord.entityId',
              '=',
              'relation.companyPatentRelationId'
            )
            .on('relationRecord.entityType', '=', 'company-patent-relations')
            .on('relationRecord.releaseId', '=', release.releaseId)
        )
        .innerJoin('patent', 'patent.patentId', 'relation.patentId')
        .innerJoin('datasetRecord as patentRecord', (join) =>
          join
            .onRef('patentRecord.entityId', '=', 'patent.patentId')
            .on('patentRecord.entityType', '=', 'patents')
            .on('patentRecord.releaseId', '=', release.releaseId)
        )
        .$if(Boolean(domainId), (domainQuery) =>
          domainQuery
            .innerJoin('patentDomainMatch as match', (join) =>
              join
                .onRef('match.patentId', '=', 'patent.patentId')
                .on('match.domainId', '=', domainId!)
            )
            .innerJoin('datasetRecord as matchRecord', (join) =>
              join
                .onRef('matchRecord.entityId', '=', 'match.domainMatchId')
                .on('matchRecord.entityType', '=', 'patent-domain-matches')
                .on('matchRecord.releaseId', '=', release.releaseId)
            )
        )

      if (query.country) {
        builder = builder.where('company.country', '=', query.country)
      }
      if (query.query) {
        const search = query.query.toLowerCase()
        const pattern = `%${escapeLike(search)}%`
        builder = builder.where((expression) =>
          expression.or([
            sql<boolean>`lower(company.preferred_name) like ${pattern} escape '\\'`,
            sql<boolean>`lower(coalesce(company.legal_name, '')) like ${pattern} escape '\\'`,
            expression.exists(
              expression
                .selectFrom('companyAlias as alias')
                .innerJoin('datasetRecord as aliasRecord', (join) =>
                  join
                    .onRef('aliasRecord.entityId', '=', 'alias.aliasId')
                    .on('aliasRecord.entityType', '=', 'company-aliases')
                    .on('aliasRecord.releaseId', '=', release.releaseId)
                )
                .select('alias.aliasId')
                .whereRef('alias.companyId', '=', 'company.companyId')
                .where(
                  sql<boolean>`lower(alias.alias_name) like ${pattern} escape '\\'`
                )
            ),
            expression.exists(
              expression
                .selectFrom('externalIdentifier as identifier')
                .innerJoin('datasetRecord as identifierRecord', (join) =>
                  join
                    .onRef(
                      'identifierRecord.entityId',
                      '=',
                      'identifier.externalIdentifierId'
                    )
                    .on(
                      'identifierRecord.entityType',
                      '=',
                      'external-identifiers'
                    )
                    .on('identifierRecord.releaseId', '=', release.releaseId)
                )
                .select('identifier.externalIdentifierId')
                .whereRef('identifier.companyId', '=', 'company.companyId')
                .where(
                  sql<boolean>`lower(identifier.identifier_value) = ${search}`
                )
            ),
          ])
        )
      }
      return builder
    }

    const count = await buildQuery()
      .select(
        sql<number>`count(distinct company.company_id)::integer`.as('total')
      )
      .executeTakeFirstOrThrow()
    let itemsQuery = buildQuery()
      .select([
        'company.companyId',
        'company.preferredName',
        'company.legalName',
        'company.country',
        'company.provider',
        'company.entityStatus',
        sql<number>`count(distinct relation.patent_id)::integer`.as(
          'patentCount'
        ),
        sql<string | null>`max(patent.patent_date)`.as('latestPatentDate'),
      ])
      .groupBy('company.companyId')

    if (query.sort === 'name') {
      itemsQuery = itemsQuery.orderBy('company.preferredName', query.order)
    } else if (query.sort === 'latestPatentDate') {
      itemsQuery = itemsQuery.orderBy('latestPatentDate', query.order)
    } else {
      itemsQuery = itemsQuery.orderBy('patentCount', query.order)
    }
    const items = await itemsQuery
      .orderBy('company.companyId')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .execute()

    return {
      release,
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: count.total,
      totalPages: Math.ceil(count.total / query.pageSize),
    }
  }

  private async assertCurrentRecord(
    releaseId: string,
    entityType: string,
    entityId: string,
    error: { code: string; message: string }
  ): Promise<void> {
    const record = await this.database
      .selectFrom('datasetRecord')
      .select('entityId')
      .where('releaseId', '=', releaseId)
      .where('entityType', '=', entityType)
      .where('entityId', '=', entityId)
      .executeTakeFirst()
    if (!record) throw new NotFoundException(error)
  }
}

function stringArray(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}
