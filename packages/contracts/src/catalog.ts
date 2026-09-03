import { z } from 'zod'
import { entityIdSchema } from './common.js'

export const catalogPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const catalogReleaseSchema = z.object({
  releaseId: z.string().trim().min(1).max(100),
  dataset: z.string().trim().min(1).max(100),
  generatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime(),
  periodFromYear: z.number().int(),
  periodToYear: z.number().int(),
  unavailableFields: z.array(z.string().trim().min(1)),
})

export const catalogDomainSchema = z.object({
  domainId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  ruleVersion: z.string().trim().min(1).max(100),
  definition: z.unknown(),
  patentCount: z.number().int().min(0),
  companyCount: z.number().int().min(0),
})

export const catalogDomainListSchema = z.object({
  release: catalogReleaseSchema,
  items: z.array(catalogDomainSchema),
})

export const catalogDomainDetailSchema = catalogDomainSchema.extend({
  yearTrend: z.array(
    z.object({
      year: z.number().int(),
      patentCount: z.number().int().min(0),
    })
  ),
  cpcGroups: z.array(
    z.object({
      cpcGroup: z.string().trim().min(1),
      patentCount: z.number().int().min(0),
    })
  ),
})

export const catalogDomainDetailResponseSchema = z.object({
  release: catalogReleaseSchema,
  domain: catalogDomainDetailSchema,
})

export const catalogPatentListQuerySchema = catalogPageQuerySchema
  .extend({
    title: z.string().trim().min(1).max(200).optional(),
    cpcPrefix: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((value) => value.toUpperCase())
      .optional(),
    partyName: z.string().trim().min(1).max(200).optional(),
    fromYear: z.coerce.number().int().min(1800).max(2100).optional(),
    toYear: z.coerce.number().int().min(1800).max(2100).optional(),
    sort: z.enum(['score', 'patentDate', 'title']).default('score'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (value) =>
      value.fromYear === undefined ||
      value.toYear === undefined ||
      value.fromYear <= value.toYear,
    { message: '起始年份不能晚于结束年份', path: ['fromYear'] }
  )

export const catalogPatentSummarySchema = z.object({
  patentId: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1),
  patentDate: z.iso.date(),
  grantYear: z.number().int(),
  patentType: z.string().nullable(),
  wipoKind: z.string().nullable(),
  numClaims: z.number().int().min(0).nullable(),
  withdrawn: z.boolean().nullable(),
  totalScore: z.number().int(),
  cpcGroups: z.array(z.string()),
  assignees: z.array(z.string()),
})

export const catalogPatentListSchema = z.object({
  release: catalogReleaseSchema,
  items: z.array(catalogPatentSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export const catalogCompanyPatentListQuerySchema = z.intersection(
  catalogPatentListQuerySchema,
  z.object({ domainId: entityIdSchema.optional() })
)

export const catalogSourceReferenceSchema = z
  .object({
    locator: z.string().trim().min(1),
    dataset: z.string().trim().min(1),
    relativePath: z.string().trim().min(1).nullable(),
    sourceRowNumber: z.number().int().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sourceRelease: z.string().trim().min(1),
    url: z.url().nullable(),
  })
  .strict()

export const catalogSourceResponseSchema = z.object({
  release: catalogReleaseSchema,
  source: catalogSourceReferenceSchema,
})

export const catalogPatentClassificationSchema = z.object({
  cpcGroup: z.string().trim().min(1),
  sequence: z.number().int().nullable(),
  type: z.string().nullable().optional(),
  actionDate: z.iso.date().nullable().optional(),
})

export const catalogPatentPartySchema = z.object({
  partyId: z.string().trim().min(1),
  role: z.string().trim().min(1),
  name: z.string().trim().min(1),
  country: z.string().nullable(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  sequence: z.number().int().nullable(),
  isIndividual: z.boolean(),
})

export const catalogPatentDomainMatchSchema = z.object({
  domainId: z.string().trim().min(1),
  domainName: z.string().trim().min(1),
  totalScore: z.number().int(),
  ruleVersion: z.string().trim().min(1),
  matchedCpcs: z.array(z.string()),
  matchedStrongKeywords: z.array(z.string()),
  matchedGeneralKeywords: z.array(z.string()),
})

export const catalogPatentDetailSchema = z.object({
  patentId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  patentDate: z.iso.date(),
  grantYear: z.number().int(),
  patentType: z.string().nullable(),
  wipoKind: z.string().nullable(),
  numClaims: z.number().int().min(0).nullable(),
  withdrawn: z.boolean().nullable(),
  classifications: z.array(catalogPatentClassificationSchema),
  parties: z.array(catalogPatentPartySchema),
  domainMatches: z.array(catalogPatentDomainMatchSchema),
  source: catalogSourceReferenceSchema,
})

export const catalogPatentDetailResponseSchema = z.object({
  release: catalogReleaseSchema,
  patent: catalogPatentDetailSchema,
})

export const catalogCompanyListQuerySchema = catalogPageQuerySchema.extend({
  query: z.string().trim().min(1).max(200).optional(),
  country: z
    .string()
    .trim()
    .min(2)
    .max(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  sort: z
    .enum(['patentCount', 'name', 'latestPatentDate'])
    .default('patentCount'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export const catalogCompanySummarySchema = z.object({
  companyId: z.string().trim().min(1),
  preferredName: z.string().trim().min(1),
  legalName: z.string().nullable(),
  country: z.string().nullable(),
  provider: z.string().trim().min(1),
  entityStatus: z.string().nullable(),
  patentCount: z.number().int().min(0),
  latestPatentDate: z.iso.date().nullable(),
})

export const catalogCompanyListSchema = z.object({
  release: catalogReleaseSchema,
  items: z.array(catalogCompanySummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export const catalogCompanyAliasSchema = z.object({
  aliasId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  provider: z.string().trim().min(1),
})

export const catalogExternalIdentifierSchema = z.object({
  identifierId: z.string().trim().min(1),
  type: z.string().trim().min(1),
  value: z.string().trim().min(1),
  provider: z.string().trim().min(1),
})

export const catalogCompanyRelationshipSchema = z.object({
  relationshipId: z.string().trim().min(1),
  direction: z.enum(['outgoing', 'incoming']),
  relatedCompany: z.object({
    companyId: z.string().trim().min(1),
    preferredName: z.string().trim().min(1),
    country: z.string().nullable(),
  }),
  relationshipType: z.string().trim().min(1),
  relationshipStatus: z.string().nullable(),
  periodStartDate: z.iso.date().nullable(),
  periodEndDate: z.iso.date().nullable(),
  periodType: z.string().nullable(),
  source: catalogSourceReferenceSchema,
})

export const catalogCompanyDomainStatSchema = z.object({
  domainId: z.string().trim().min(1),
  domainName: z.string().trim().min(1),
  patentCount: z.number().int().min(0),
  latestPatentDate: z.iso.date().nullable(),
})

export const catalogAcceptedMatchSchema = z.object({
  candidateId: z.string().trim().min(1),
  representativeName: z.string().trim().min(1),
  country: z.string().nullable(),
  patentCount: z.number().int().min(0),
  matchMethod: z.string().trim().min(1),
  similarityScore: z.number().min(0).max(1).nullable(),
  decision: z.string().trim().min(1),
  decisionReason: z.string().trim().min(1),
  ruleVersion: z.string().trim().min(1),
})

export const catalogCompanyDetailSchema = z.object({
  companyId: z.string().trim().min(1),
  preferredName: z.string().trim().min(1),
  legalName: z.string().nullable(),
  country: z.string().nullable(),
  provider: z.string().trim().min(1),
  entityStatus: z.string().nullable(),
  aliases: z.array(catalogCompanyAliasSchema),
  externalIdentifiers: z.array(catalogExternalIdentifierSchema),
  relationships: z.array(catalogCompanyRelationshipSchema),
  domainStats: z.array(catalogCompanyDomainStatSchema),
  acceptedMatches: z.array(catalogAcceptedMatchSchema),
  source: catalogSourceReferenceSchema,
})

export const catalogCompanyDetailResponseSchema = z.object({
  release: catalogReleaseSchema,
  company: catalogCompanyDetailSchema,
})

export const catalogCandidateSuggestionSchema = z.object({
  matchId: z.string().trim().min(1),
  suggestedCompanyId: z.string().nullable(),
  suggestedName: z.string().nullable(),
  provider: z.string().nullable(),
  matchMethod: z.string().trim().min(1),
  similarityScore: z.number().min(0).max(1).nullable(),
  decision: z.string().trim().min(1),
  decisionReason: z.string().trim().min(1),
  accepted: z.boolean(),
})

export const catalogCandidateDecisionSchema = z.object({
  value: z.string().trim().min(1),
  organizationType: z.string().trim().min(1),
  selectedCompanyId: z.string().nullable(),
  reviewMethod: z.string().trim().min(1),
  reviewedAt: z.iso.datetime().nullable(),
  reviewer: z.string().nullable(),
  note: z.string().nullable(),
})

export const catalogCandidateDetailSchema = z.object({
  candidateId: z.string().trim().min(1),
  representativeName: z.string().trim().min(1),
  country: z.string().nullable(),
  patentCount: z.number().int().min(0),
  partyRowCount: z.number().int().min(0),
  rawNameVariantCount: z.number().int().min(0),
  decision: catalogCandidateDecisionSchema.nullable(),
  suggestions: z.array(catalogCandidateSuggestionSchema),
  evidenceCount: z.number().int().min(0),
})

export const catalogCandidateDetailResponseSchema = z.object({
  release: catalogReleaseSchema,
  candidate: catalogCandidateDetailSchema,
})

export const catalogEvidenceSchema = z.object({
  evidenceId: z.string().trim().min(1),
  candidateId: z.string().trim().min(1),
  publisher: z.string().trim().min(1),
  sourceType: z.string().trim().min(1),
  sourceUrl: z.url(),
  observedAt: z.iso.datetime(),
  legalName: z.string().nullable(),
  country: z.string().nullable(),
  identifierType: z.string().nullable(),
  identifierValue: z.string().nullable(),
  preserved: z.boolean(),
  contentSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  source: catalogSourceReferenceSchema,
})

export const catalogEvidenceListSchema = z.object({
  release: catalogReleaseSchema,
  items: z.array(catalogEvidenceSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export type CatalogPageQuery = z.infer<typeof catalogPageQuerySchema>
export type CatalogRelease = z.infer<typeof catalogReleaseSchema>
export type CatalogDomain = z.infer<typeof catalogDomainSchema>
export type CatalogDomainList = z.infer<typeof catalogDomainListSchema>
export type CatalogDomainDetailResponse = z.infer<
  typeof catalogDomainDetailResponseSchema
>
export type CatalogPatentListQuery = z.infer<
  typeof catalogPatentListQuerySchema
>
export type CatalogPatentSummary = z.infer<typeof catalogPatentSummarySchema>
export type CatalogPatentList = z.infer<typeof catalogPatentListSchema>
export type CatalogCompanyPatentListQuery = z.infer<
  typeof catalogCompanyPatentListQuerySchema
>
export type CatalogSourceReference = z.infer<
  typeof catalogSourceReferenceSchema
>
export type CatalogSourceResponse = z.infer<typeof catalogSourceResponseSchema>
export type CatalogPatentDetail = z.infer<typeof catalogPatentDetailSchema>
export type CatalogPatentDetailResponse = z.infer<
  typeof catalogPatentDetailResponseSchema
>
export type CatalogCompanyListQuery = z.infer<
  typeof catalogCompanyListQuerySchema
>
export type CatalogCompanySummary = z.infer<typeof catalogCompanySummarySchema>
export type CatalogCompanyList = z.infer<typeof catalogCompanyListSchema>
export type CatalogCompanyDetail = z.infer<typeof catalogCompanyDetailSchema>
export type CatalogCompanyDetailResponse = z.infer<
  typeof catalogCompanyDetailResponseSchema
>
export type CatalogCandidateDetailResponse = z.infer<
  typeof catalogCandidateDetailResponseSchema
>
export type CatalogEvidence = z.infer<typeof catalogEvidenceSchema>
export type CatalogEvidenceList = z.infer<typeof catalogEvidenceListSchema>
