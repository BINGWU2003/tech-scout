import { Injectable, NotFoundException } from '@nestjs/common'
import {
  libraryDetailSchema,
  libraryListSchema,
  libraryRunsSchema,
  type LibraryQuery,
} from '@tech-scout/contracts'
import { CatalogPrismaService } from '../database/catalog-prisma.service.js'
import { Prisma } from '../generated/catalog/client.js'

type Kind = 'patent' | 'company'
type LibraryRow = {
  id: string
  data: Prisma.JsonObject
  updated_at: Date
  sources: Prisma.JsonValue
}

@Injectable()
export class LibraryRepository {
  constructor(private readonly catalog: CatalogPrismaService) {}

  async runs() {
    const jobs = await this.catalog.ingestionJob.findMany({
      select: { runId: true, status: true, plan: true },
      orderBy: [{ createdAt: 'desc' }, { runId: 'desc' }],
    })
    return libraryRunsSchema.parse(
      jobs.map(({ runId, status, plan }) => ({
        runId,
        status,
        directions: (
          (plan as { directions?: { name: string }[] }).directions ?? []
        ).map((d) => d.name),
      }))
    )
  }

  // Only fixed identifiers enter SQL fragments; all request values are bindings.
  private config(kind: Kind) {
    return kind === 'patent'
      ? {
          table: Prisma.sql`catalog_v2.patent`,
          key: Prisma.sql`f.publication_number`,
          name: 'title',
        }
      : {
          table: Prisma.sql`catalog_v2.company`,
          key: Prisma.sql`f.company_id`,
          name: 'name',
        }
  }

  private sources(kind: Kind, key: Prisma.Sql) {
    return Prisma.sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'runId',s.run_id,'status',j.status,
      'directions',(SELECT COALESCE(jsonb_agg(d->>'name'),'[]'::jsonb) FROM jsonb_array_elements(j.plan->'directions') d
        WHERE s.kind='company' OR s.data->'domain_ids' IS NULL OR s.data->'domain_ids' ? (d->>'domain_id')),
      'observedAt',s.data->>'observed_at','url',s.data->>'source_url','sha256',s.data->>'source_sha256') ORDER BY j.created_at DESC)
      FROM catalog_v2.record_source s JOIN ingestion.job j USING(run_id)
      WHERE s.kind=${kind} AND s.record_id=${key}::text),'[]'::jsonb) AS sources`
  }

  private record(row: LibraryRow) {
    const d = row.data
    return {
      id: row.id,
      name: d.title ?? d.name ?? '',
      date: d.publication_date ?? null,
      creditCode: d.credit_code ?? null,
      currentAssignees: d.current_assignees ?? [],
      originalAssignees: d.original_assignees ?? [],
      sources: row.sources,
      updatedAt: row.updated_at.toISOString(),
    }
  }

  async list(kind: Kind, q: LibraryQuery) {
    const { table, key, name } = this.config(kind)
    const where = Prisma.sql`WHERE (strpos(lower(f.data->>${name}::text),lower(${q.query}::text))>0 OR strpos(lower(${key}::text),lower(${q.query}::text))>0)
      AND (${q.runId ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM catalog_v2.record_source s WHERE s.kind=${kind} AND s.record_id=${key}::text AND s.run_id=${q.runId ?? null}::uuid))`
    const [count, result] = await Promise.all([
      this.catalog.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT count(*)::int AS n FROM ${table} f ${where}`
      ),
      this.catalog.$queryRaw<LibraryRow[]>(Prisma.sql`
        SELECT ${key}::text AS id, f.data - 'abstract' - 'claims' - 'description' - 'html' - 'raw_html' AS data, f.updated_at,
        ${this.sources(kind, key)} FROM ${table} f ${where}
        ORDER BY f.updated_at DESC,${key} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
    ])
    return libraryListSchema.parse({
      items: result.map((r) => this.record(r)),
      page: q.page,
      pageSize: q.pageSize,
      total: count[0].n,
    })
  }

  async detail(kind: Kind, id: string) {
    const { table, key } = this.config(kind)
    const rows = await this.catalog.$queryRaw<LibraryRow[]>(Prisma.sql`
      SELECT ${key}::text AS id,f.data,f.updated_at,${this.sources(kind, key)}
      FROM ${table} f WHERE ${key}::text=${id}`)
    const row = rows[0]
    if (!row) throw new NotFoundException('记录不存在')
    return libraryDetailSchema.parse({
      ...this.record(row),
      abstract: row.data.abstract ?? null,
      claims: row.data.claims ?? null,
      description: row.data.description ?? null,
      cpcs: row.data.cpcs ?? [],
      businessInfo: row.data.fields ?? {},
      // Agent-inferred ownership stays private to each research run.
      relations: [],
    })
  }
}
