import { z } from 'zod'
import {
  researchPlanSchema,
  researchReasoningSchema,
  researchAnswerSchema,
  researchStateSchema,
  researchStatusSchema,
} from './research.js'

export const researchViewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  companyId: z.string().max(255).optional(),
  patentId: z.string().max(255).optional(),
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
      searchFailed: z.number().int().nonnegative().optional(),
      detailFailed: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .default(null),
  fromYear: z.number().nullable(),
  toYear: z.number().nullable(),
  domains: z.array(z.object({ id: z.string(), name: z.string() })),
  plan: researchPlanSchema.nullable(),
  confirmedPlan: researchPlanSchema.nullable(),
  workflowVersion: z.literal('browser-v3').default('browser-v3'),
  queriedAssigneeCount: z.number().int().nonnegative().default(0),
  discoveredCompanyCount: z.number().int().nonnegative().default(0),
  hasResult: z.boolean(),
  hasPatents: z.boolean().default(false),
  hasCompanies: z.boolean().default(false),
})
export const researchCompanyMatchesSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      country: z.string().nullable(),
      queryNames: z.array(z.string()),
      providerRank: z.number().int().nonnegative(),
    })
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export const researchProcessSchema = z.object({
  stage: z.string(),
  message: z.string(),
  direction: z.string().nullable().optional(),
  keyword: z.string().optional(),
  domainId: z.string().optional(),
  publicationNumber: z.string().optional(),
  finishReason: z
    .enum(['page_limit', 'no_results', 'repeated_page', 'failed'])
    .optional(),
  url: z
    .string()
    .regex(/^https:\/\/patents\.google\.com\//)
    .nullable()
    .optional(),
  page: z.number().int().positive().optional(),
  count: z.number().int().nonnegative().optional(),
  completed: z.number().int().nonnegative().optional(),
  outcome: z.enum(['running', 'completed', 'failed', 'stopped']),
  occurredAt: z.string().optional(),
})
export const researchProgressViewSchema = z.object({
  sequence: z.number().int(),
  kind: z.string(),
  createdAt: z.string(),
  status: researchStatusSchema,
  node: z.string().nullable(),
  error: researchStateSchema.shape.error,
  process: researchProcessSchema.nullable().optional(),
  reasoning: researchReasoningSchema.nullable(),
  answer: researchAnswerSchema.nullable(),
  acquisition: researchSummaryViewSchema.shape.acquisition.optional(),
})
export const researchCompanyViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  assigneeNames: z.array(z.string()),
  leadPatentCount: z.number().int().nonnegative(),
  citationIds: z.array(z.string()),
})
export const researchPatentAssessmentSchema = z.object({
  id: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
})
export const researchResultViewSchema = z.object({
  releaseId: z.string(),
  patentCount: z.number().int(),
  companies: z.array(researchCompanyViewSchema),
  patents: z.array(researchPatentAssessmentSchema),
  missing: z.array(z.string()),
  emptyReason: z.string().nullable(),
})
export const researchPatentViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  // Publication year; null when the source does not provide it.
  year: z.number().nullable(),
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
      assigneeName: z.string(),
      basis: z.enum(['legal_name', 'alias', 'search_hit']),
    })
  ),
  source: researchSourceViewSchema,
})
export const researchPatentPageSchema = z.object({
  items: z.array(researchPatentViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export const researchPatentStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  years: z.array(
    z.object({
      year: z.number().int(),
      count: z.number().int().nonnegative(),
    })
  ),
  unknownYearCount: z.number().int().nonnegative(),
  classifications: z.array(
    z.object({
      code: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
  unclassifiedCount: z.number().int().nonnegative(),
})
export type ResearchSummaryView = z.infer<typeof researchSummaryViewSchema>
export type ResearchProgressView = z.infer<typeof researchProgressViewSchema>
export type ResearchResultView = z.infer<typeof researchResultViewSchema>
export type ResearchSourceView = z.infer<typeof researchSourceViewSchema>
export type ResearchViewQuery = z.infer<typeof researchViewQuerySchema>

export const researchCompanyStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  ranking: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      patentCount: z.number().int().nonnegative(),
    })
  ),
})
