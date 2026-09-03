import { z } from 'zod'

export const entityIdSchema = z.string().trim().min(1).max(255)

export const cursorPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const apiErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  details: z.unknown().optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>
