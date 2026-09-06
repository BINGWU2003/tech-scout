import { z } from 'zod'

const term = z.string().trim().min(1).max(200)
export const researchDirectionSchema = z
  .object({
    domain_id: z.string().min(1).max(100),
    name: term,
    keywords: z.array(term).max(12).default([]),
    excluded_keywords: z.array(term).max(12).default([]),
    cpc_prefixes: z.array(term).max(12).default([]),
    explanation: z.string().max(2000),
  })
  .strict()
export const researchPlanSchema = z
  .object({
    directions: z.array(researchDirectionSchema).min(1).max(3),
    from_year: z.number().int().min(1800).max(2100),
    to_year: z.number().int().min(1800).max(2100),
    risks: z.array(z.string()).max(20).default([]),
  })
  .strict()
  .refine((p) => p.from_year <= p.to_year, '起始年份不能晚于结束年份')
export const researchCreateSchema = z
  .object({
    requestKey: z.uuid(),
    question: z.string().trim().min(1).max(2000),
  })
  .strict()
export const researchActionSchema = z
  .object({
    action_id: z.uuid(),
    kind: z.enum(['confirm_plan', 'resolve_entities', 'retry', 'cancel']),
    plan: researchPlanSchema.nullable().optional(),
    decisions: z
      .array(
        z
          .object({
            candidate_id: z.string().min(1).max(255),
            action: z.enum(['confirm', 'reject', 'skip']),
            company_id: z.string().nullable().default(null),
            evidence_ids: z.array(z.string()).max(30).default([]),
            note: z.string().max(2000).default(''),
          })
          .strict()
      )
      .max(1000)
      .default([]),
  })
  .strict()
  .superRefine((a, ctx) => {
    if ((a.kind === 'confirm_plan') !== Boolean(a.plan)) {
      ctx.addIssue({ code: 'custom', message: '只有确认计划动作需要 plan' })
    }
    if (a.kind !== 'resolve_entities' && a.decisions.length) {
      ctx.addIssue({ code: 'custom', message: '当前动作不接受身份决定' })
    }
  })
export const researchStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_plan',
  'awaiting_entities',
  'completed',
  'empty',
  'failed',
  'recoverable',
  'cancelled',
])
export const researchStateSchema = z
  .object({
    run_id: z.uuid(),
    status: researchStatusSchema,
    sequence: z.number().int().nonnegative(),
    node: z.string().nullable().default(null),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        node: z.string().nullable().optional(),
      })
      .nullable()
      .default(null),
    budget: z.object({
      requests: z.number().int().nonnegative(),
      reserved_cny: z.number().nonnegative(),
      estimated_cny: z.number().nonnegative(),
      elapsed_seconds: z.number().nonnegative(),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      max_requests: z.number().int().positive(),
      max_seconds: z.number().positive(),
      max_cny: z.number().positive(),
    }),
    artifacts: z.record(z.string(), z.unknown()),
  })
  .strict()
export const researchEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    kind: z.string(),
    created_at: z.string(),
    data: researchStateSchema,
  })
  .strict()
export const researchEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
})
export type ResearchCreate = z.infer<typeof researchCreateSchema>
export type ResearchAction = z.infer<typeof researchActionSchema>
export type ResearchState = z.infer<typeof researchStateSchema>
export type ResearchEvent = z.infer<typeof researchEventSchema>

export const researchRunSummarySchema = z.object({
  id: z.uuid(),
  status: researchStatusSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
})
export const researchProjectSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  question: z.string(),
  createdAt: z.iso.datetime(),
})
export const researchProjectSchema = researchProjectSummarySchema.extend({
  runs: z.array(researchRunSummarySchema),
})
export const researchRunSchema = researchRunSummarySchema.extend({
  projectId: z.uuid(),
  question: z.string(),
  updatedAt: z.iso.datetime(),
  state: z.union([researchStateSchema, z.object({}).strict()]),
})
export const researchStoredEventSchema = z.object({
  runId: z.uuid(),
  sequence: z.number().int().positive(),
  kind: z.string(),
  data: researchStateSchema,
  createdAt: z.iso.datetime(),
})
