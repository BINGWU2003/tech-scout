import { type HistoryState } from '@tanstack/history'
import { z } from 'zod'

export type LibraryKind = 'companies' | 'patents'

export const librarySearchSchema = z.object({
  page: z.number().int().min(1).optional().catch(1),
  pageSize: z
    .union([
      z.literal(10),
      z.literal(20),
      z.literal(30),
      z.literal(40),
      z.literal(50),
    ])
    .optional()
    .catch(20),
  query: z.string().max(200).optional().catch(''),
  runId: z.uuid().optional().catch(undefined),
})

export type LibrarySearch = z.infer<typeof librarySearchSchema>

export function withLibraryDetail(kind: LibraryKind, id: string) {
  return (previous: HistoryState): HistoryState => ({
    ...previous,
    libraryDetail: { kind, id },
  })
}
