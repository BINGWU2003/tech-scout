import { z } from 'zod'
import {
  researchPlanSchema,
  researchStateSchema,
  researchStatusSchema,
} from './research.js'

export const researchViewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  companyId: z.string().max(255).optional(),
  patentId: z.string().max(255).optional(),
  pending: z.enum(['true', 'false']).default('false'),
})
export const researchSourceViewSchema = z.object({
  url: z.string().nullable().optional(),
  sha256: z.string().nullable(),
})
export const researchSummaryViewSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  question: z.string(),
  status: researchStatusSchema,
  sequence: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ready: z.boolean(),
  node: z.string().nullable(),
  error: researchStateSchema.shape.error,
  budget: researchStateSchema.shape.budget.nullable(),
  releaseId: z.string().nullable(),
  sourceMode: z.literal('browser').default('browser'),
  acquisition: z
    .object({
      status: z.string(),
      stage: z.string().nullable().default(null),
      completed: z.number().nullable().default(null),
      total: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
  fromYear: z.number().nullable(),
  toYear: z.number().nullable(),
  domains: z.array(z.object({ id: z.string(), name: z.string() })),
  plan: researchPlanSchema.nullable(),
  confirmedPlan: researchPlanSchema.nullable(),
  pendingCandidateIds: z.array(z.string()),
  candidateCount: z.number().int(),
  hasResult: z.boolean(),
})
export const researchProgressViewSchema = z.object({
  sequence: z.number().int(),
  kind: z.string(),
  createdAt: z.string(),
  status: researchStatusSchema,
  node: z.string().nullable(),
  error: researchStateSchema.shape.error,
})
export const researchCompanyViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().nullable(),
  identity: z.string(),
  patentCount: z.number().int(),
  ruleScore: z.number(),
  trend: z.record(z.string(), z.number()),
  latestYear: z.number().nullable(),
  explanation: z.string().nullable(),
  citationIds: z.array(z.string()),
})
export const researchResultViewSchema = z.object({
  releaseId: z.string(),
  patentCount: z.number().int(),
  companies: z.array(researchCompanyViewSchema),
  missing: z.array(z.string()),
  emptyReason: z.string().nullable(),
  unverifiedCount: z.number().int(),
  conflictCount: z.number().int(),
})
export const researchPatentViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  dateKind: z.enum(['publication', 'grant']).default('grant'),
  abstract: z.string().nullable().optional(),
  claims: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  parties: z
    .array(z.object({ name: z.string(), roles: z.array(z.string()) }))
    .default([]),
  cpcs: z.array(z.string()),
  domains: z.array(z.string()),
  source: researchSourceViewSchema,
})
export const researchEvidenceViewSchema = z.object({
  id: z.string(),
  publisher: z.string().nullable(),
  observedAt: z.string().nullable(),
  legalName: z.string().nullable(),
  country: z.string().nullable(),
  identifierType: z.string().nullable(),
  identifierValue: z.string().nullable(),
  preserved: z.boolean(),
  contentHash: z.string().nullable(),
  source: researchSourceViewSchema,
})
export const researchCandidateViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().nullable(),
  status: z.string(),
  needsReview: z.boolean(),
  terminalExclusion: z.boolean(),
  decision: z.string().nullable(),
  patentCount: z.number().int(),
})
export const researchCandidateDetailViewSchema =
  researchCandidateViewSchema.extend({
    evidence: z.array(researchEvidenceViewSchema),
    reviewNote: z.string().nullable(),
    companyOptions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        country: z.string().nullable(),
        supportingEvidenceIds: z.array(z.string()),
      })
    ),
  })
export const researchCompanyDetailViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  country: z.string().nullable(),
  businessInfo: z.record(z.string(), z.string()).default({}),
  aliases: z.array(z.string()),
  identifiers: z.array(z.object({ type: z.string(), value: z.string() })),
  relations: z.array(
    z.object({
      patentId: z.string(),
      method: z.string(),
      decision: z.string().nullable(),
    })
  ),
  evidence: z.array(researchEvidenceViewSchema),
  source: researchSourceViewSchema,
  confirmations: z.array(
    z.object({
      actorId: z.string(),
      confirmedAt: z.string(),
      note: z.string(),
      evidenceIds: z.array(z.string()),
    })
  ),
})
export const researchPatentPageSchema = z.object({
  items: z.array(researchPatentViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export const researchCandidatePageSchema = z.object({
  items: z.array(researchCandidateViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export const researchConflictPageSchema = z.object({
  items: z.array(
    z.object({
      candidateId: z.string(),
      name: z.string(),
      kind: z.string(),
      note: z.string(),
      identifierType: z.string().nullable(),
      values: z.record(z.string(), z.array(z.string())),
    })
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export type ResearchSummaryView = z.infer<typeof researchSummaryViewSchema>
export type ResearchProgressView = z.infer<typeof researchProgressViewSchema>
export type ResearchResultView = z.infer<typeof researchResultViewSchema>
export type ResearchCandidateDetailView = z.infer<
  typeof researchCandidateDetailViewSchema
>
export type ResearchSourceView = z.infer<typeof researchSourceViewSchema>
export type ResearchViewQuery = z.infer<typeof researchViewQuerySchema>
