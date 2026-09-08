import { z } from 'zod'

export const libraryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).default(''),
  runId: z.uuid().optional(),
})
export type LibraryQuery = z.infer<typeof libraryQuerySchema>
export const librarySourceSchema = z.object({
  runId: z.uuid(),
  status: z.string(),
  directions: z.array(z.string()),
  observedAt: z.string().nullable(),
  url: z.string().nullable(),
  sha256: z.string().nullable(),
})
export const libraryRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string().nullable(),
  creditCode: z.string().nullable(),
  currentAssignees: z.array(z.string()),
  originalAssignees: z.array(z.string()),
  sources: z.array(librarySourceSchema),
  updatedAt: z.string(),
})
export type LibraryRecord = z.infer<typeof libraryRecordSchema>
export const libraryListSchema = z.object({
  items: z.array(libraryRecordSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
})
export const libraryDetailSchema = libraryRecordSchema.extend({
  abstract: z.string().nullable(),
  claims: z.string().nullable(),
  description: z.string().nullable(),
  cpcs: z.array(z.string()),
  businessInfo: z.record(z.string(), z.unknown()),
  relations: z.array(
    z.object({
      runId: z.uuid(),
      patentId: z.string(),
      companyId: z.string(),
      role: z.string(),
      status: z.string(),
    })
  ),
})
export const libraryRunsSchema = z.array(
  z.object({
    runId: z.uuid(),
    status: z.string(),
    directions: z.array(z.string()),
  })
)
