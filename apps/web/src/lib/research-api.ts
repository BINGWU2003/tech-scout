import {
  researchWorkspaceSchema,
  researchRunSchema,
  researchKeywordsSchema,
  researchKeywordRequestSchema,
  type ResearchWorkspaceAction,
  researchProjectSchema,
  researchProjectSummarySchema,
  researchSummaryViewSchema,
  researchProgressViewSchema,
  researchResultViewSchema,
  researchPatentPageSchema,
  researchPatentStatsSchema,
  researchCompanyDetailViewSchema,
  researchCompanyMatchesSchema,
  researchCompanyStatsSchema,
  type ResearchAction,
  type ResearchCreate,
} from '@tech-scout/contracts'
import { z } from 'zod'
import { apiRequest } from './api-client'

const run = (id: string) => `research/ui/runs/${encodeURIComponent(id)}`
export const researchApi = {
  generateKeywords: async (
    id: string,
    input: z.infer<typeof researchKeywordRequestSchema>
  ) => {
    const started = await apiRequest(
      `research/projects/${id}/keywords`,
      researchRunSchema,
      {
        method: 'POST',
        json: input,
        retry: 0,
      }
    )
    const deadline = Date.now() + 300000
    let current = started
    for (;;) {
      const state = current.state
      if (
        current.status === 'awaiting_plan' &&
        'artifacts' in state &&
        state.artifacts.generated_keywords
      )
        return researchKeywordsSchema.parse(state.artifacts.generated_keywords)
          .keywords
      if (!['queued', 'running'].includes(current.status))
        throw new Error('关键词生成失败，请重试；原关键词已保留。')
      if (Date.now() >= deadline)
        throw new Error('关键词生成超时，请稍后重试；原关键词已保留。')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      current = await apiRequest(
        `research/runs/${started.id}`,
        researchRunSchema
      )
    }
  },
  workspace: (id: string) =>
    apiRequest(`research/ui/projects/${id}/workspace`, researchWorkspaceSchema),
  workspaceAction: (id: string, input: ResearchWorkspaceAction) =>
    apiRequest(
      `research/ui/projects/${id}/workspace`,
      researchWorkspaceSchema,
      { method: 'POST', json: input, retry: 0 }
    ),
  projects: () =>
    apiRequest('research/projects', z.array(researchProjectSummarySchema)),
  deleteProject: (id: string) =>
    apiRequest(
      `research/projects/${id}`,
      z.object({ deleted: z.literal(true), runIds: z.array(z.uuid()) }),
      { method: 'DELETE', retry: 0, timeout: 125000 }
    ),
  project: (id: string) =>
    apiRequest(`research/projects/${id}`, researchProjectSchema),
  create: (input: ResearchCreate) =>
    apiRequest('research/projects', researchProjectSchema, {
      method: 'POST',
      json: input,
      retry: 0,
    }),
  newRun: (id: string, input: ResearchCreate) =>
    apiRequest(`research/ui/projects/${id}/runs`, researchSummaryViewSchema, {
      method: 'POST',
      json: input,
      retry: 0,
    }),
  summary: (id: string) => apiRequest(run(id), researchSummaryViewSchema),
  events: async (id: string) => {
    const events: z.infer<typeof researchProgressViewSchema>[] = []
    let after = 0
    for (;;) {
      const page = await apiRequest(
        `${run(id)}/events?after=${after}`,
        z.array(researchProgressViewSchema)
      )
      events.push(...page)
      if (page.length < 100) break
      const next = page[page.length - 1].sequence
      if (next <= after) throw new Error('研究事件游标没有前进，请重新读取')
      after = next
    }
    return events
  },
  action: (id: string, input: ResearchAction) =>
    apiRequest(`${run(id)}/actions`, researchSummaryViewSchema, {
      method: 'POST',
      json: input,
      retry: 0,
    }),
  result: (id: string) =>
    apiRequest(`${run(id)}/result`, researchResultViewSchema),
  patents: (id: string, page: number, companyId?: string) =>
    apiRequest(
      `${run(id)}/patents?page=${page}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`,
      researchPatentPageSchema
    ),
  patentStats: (id: string) =>
    apiRequest(`${run(id)}/patent-stats`, researchPatentStatsSchema),
  patent: (id: string, patentId: string) =>
    apiRequest(
      `${run(id)}/patents?patentId=${encodeURIComponent(patentId)}`,
      researchPatentPageSchema
    ),
  company: (id: string, companyId: string) =>
    apiRequest(
      `${run(id)}/companies/${encodeURIComponent(companyId)}`,
      researchCompanyDetailViewSchema
    ),
  companyStats: (id: string) =>
    apiRequest(`${run(id)}/company-stats`, researchCompanyStatsSchema),
  companyMatches: (id: string, page: number) =>
    apiRequest(
      `${run(id)}/companies?page=${page}`,
      researchCompanyMatchesSchema
    ),
}
