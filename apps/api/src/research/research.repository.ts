import type { ResearchSummaryView } from '@tech-scout/contracts'
import { Prisma } from '../generated/prisma/client.js'

// Both a root client and an existing transaction can execute projections.
// Callers must pass the transaction client when reading under a lock.
type DatabaseClient = Pick<Prisma.TransactionClient, '$queryRaw'>

// These SQL projections avoid loading multi-megabyte artifacts into application memory.
export function listProjects(db: DatabaseClient, userId: string) {
  return db.$queryRaw<
    {
      id: string
      title: string
      question: string
      createdAt: Date
      runId: string | null
      sequence: number | null
      status: string | null
      node: string | null
      reasoning: string | null
      error: unknown
      acquisition: ResearchSummaryView['acquisition']
    }[]
  >(Prisma.sql`
      SELECT p.id, p.title, p.question, p.created_at AS "createdAt",
        r.id AS "runId", r.status, r.sequence, r.state ->> 'node' AS node,
        r.state #>> '{artifacts,reasoning,status}' AS reasoning,
        r.state -> 'error' AS error,
        r.state #> '{artifacts,acquisition}' AS acquisition
      FROM app.research_project p
      LEFT JOIN LATERAL (
        SELECT id, status, sequence, state FROM app.research_run
        WHERE project_id = p.id
        ORDER BY (status IN ('queued', 'running')) DESC, created_at DESC, id DESC LIMIT 1
      ) r ON true
      WHERE p.user_id = ${userId}::uuid
      ORDER BY p.created_at DESC, p.id ASC LIMIT 100`)
}

export function conversationHistory(db: DatabaseClient, projectId: string) {
  return db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT question, state #>> '{artifacts,reply}' AS reply
        FROM app.research_run
        WHERE project_id = ${projectId}::uuid
          AND COALESCE(context ->> 'startSearch', 'false') = 'false'
        ORDER BY created_at DESC, id DESC LIMIT 20`)
}

export function workspaceRuns(db: DatabaseClient, projectId: string) {
  return db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT id, question, status, created_at AS "createdAt", context,
        state ->> 'node' AS node,
        state #>> '{error,node}' AS "errorNode",
        state #> '{artifacts,plan}' AS plan,
        state #> '{artifacts,candidate_plan}' AS candidates,
        state #> '{artifacts,confirmed_plan}' AS confirmed,
        state #> '{artifacts,reply}' AS reply,
        state #> '{artifacts,reasoning}' AS reasoning,
        state #> '{artifacts,answer}' AS answer,
        state #>> '{artifacts,reply_intent}' AS intent,
        state #> '{artifacts,proposal_plan}' AS proposal,
        state #> '{artifacts,result}' IS NOT NULL AS "hasResult"
      FROM app.research_run WHERE project_id = ${projectId}::uuid
      ORDER BY created_at, id`)
}

export function runSummary(db: DatabaseClient, userId: string, id: string) {
  return db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT r.id, r.project_id AS "projectId", r.question, r.status, r.sequence,
        r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.state - 'artifacts' AS state,
        r.state #> '{artifacts,context}' AS context,
        r.state #> '{artifacts,acquisition}' AS acquisition,
        r.state #>> '{artifacts,snapshot,release,release_id}' AS "snapshotReleaseId",
        r.state #> '{artifacts,plan}' AS plan, r.state #> '{artifacts,confirmed_plan}' AS confirmed,
        COALESCE(jsonb_array_length(r.state #> '{artifacts,assignees}'), 0) AS "queriedAssigneeCount",
        COALESCE(jsonb_array_length(r.state #> '{artifacts,snapshot,companies}'), 0) AS "discoveredCompanyCount",
        COALESCE(r.state #>> '{artifacts,result,workflow_version}',
          r.state #>> '{artifacts,execution_config,workflow_version}') AS "workflowVersion",
        r.state #> '{artifacts,result}' IS NOT NULL AS "hasResult",
        r.state #> '{artifacts,patents}' IS NOT NULL AS "hasPatents",
        r.state #> '{artifacts,company_leads}' IS NOT NULL AS "hasCompanies"
      FROM app.research_run r JOIN app.research_project p ON p.id = r.project_id
      WHERE r.id = ${id}::uuid AND p.user_id = ${userId}::uuid`)
}

export function runEvents(db: DatabaseClient, id: string, after: number) {
  return db.$queryRaw<
    Array<{
      sequence: number
      kind: string
      createdAt: string
      status: string
      node: string | null
      error: unknown
      process: unknown
      reasoning: unknown
      answer: unknown
      acquisition: unknown
    }>
  >(Prisma.sql`
      SELECT e.sequence, e.kind, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
        e.data->>'status' AS status, e.data->>'node' AS node, e.data->'error' AS error,
        CASE WHEN e.kind IN ('planner_progress', 'search_progress')
          THEN e.data #> '{artifacts,process}' END AS process,
        CASE WHEN e.kind = 'acquisition_progress'
          THEN e.data #> '{artifacts,acquisition}' END AS acquisition,
        CASE WHEN e.kind = 'reasoning_progress' OR e.data->>'status' NOT IN ('queued', 'running')
          THEN e.data #> '{artifacts,reasoning}' END AS reasoning,
        CASE WHEN e.kind = 'answer_progress' OR e.data->>'status' NOT IN ('queued', 'running')
          THEN e.data #> '{artifacts,answer}' END AS answer
      FROM app.research_event e WHERE e.run_id = ${id}::uuid AND e.sequence > ${after}
      ORDER BY e.sequence ASC LIMIT 100`)
}

export function lockProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId?: string
) {
  return tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM app.research_project WHERE id = ${projectId}::uuid
    ${userId === undefined ? Prisma.empty : Prisma.sql`AND user_id = ${userId}::uuid`}
    FOR UPDATE`)
}

export function lockRun(tx: Prisma.TransactionClient, runId: string) {
  return tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM app.research_run WHERE id = ${runId}::uuid FOR KEY SHARE`
}
