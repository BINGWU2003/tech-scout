import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common'
import {
  libraryDetailSchema,
  libraryListSchema,
  libraryRunsSchema,
  type LibraryQuery,
} from '@tech-scout/contracts'
import { Pool } from 'pg'

type Kind = 'patent' | 'company'
@Injectable()
export class LibraryRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.CATALOG_DATABASE_URL,
    max: 5,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  })
  async onModuleDestroy() {
    await this.pool.end()
  }
  async runs() {
    const { rows } = await this.pool.query(`SELECT run_id AS "runId", status,
      ARRAY(SELECT d->>'name' FROM jsonb_array_elements(plan->'directions') d) AS directions
      FROM ingestion.job ORDER BY created_at DESC,run_id DESC`)
    return libraryRunsSchema.parse(rows)
  }
  private config(kind: Kind) {
    return kind === 'patent'
      ? { table: 'patent', key: 'publication_number', name: 'title' }
      : { table: 'company', key: 'company_id', name: 'name' }
  }
  private sources = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'runId',s.run_id,'status',j.status,
      'directions',(SELECT COALESCE(jsonb_agg(d->>'name'),'[]'::jsonb) FROM jsonb_array_elements(j.plan->'directions') d
        WHERE s.kind='company' OR s.data->'domain_ids' IS NULL OR s.data->'domain_ids' ? (d->>'domain_id')),
      'observedAt',s.data->>'observed_at','url',s.data->>'source_url','sha256',s.data->>'source_sha256') ORDER BY j.created_at DESC)
      FROM catalog_v2.record_source s JOIN ingestion.job j USING(run_id)
      WHERE s.kind=$1 AND s.record_id=f.%KEY%::text),'[]'::jsonb) AS sources`
  private record(row: Record<string, any>) {
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
    const where = `WHERE (strpos(lower(f.data->>'${name}'),lower($2))>0 OR strpos(lower(f.${key}::text),lower($2))>0)
      AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM catalog_v2.record_source s WHERE s.kind=$1 AND s.record_id=f.${key}::text AND s.run_id=$3))`
    const args = [kind, q.query, q.runId ?? null]
    const [count, result] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::int AS n FROM catalog_v2.${table} f ${where}`,
        args
      ),
      this.pool.query(
        `SELECT f.${key}::text AS id, f.data - 'abstract' - 'claims' - 'description' - 'html' - 'raw_html' AS data, f.updated_at,
        ${this.sources.replace('%KEY%', key)} FROM catalog_v2.${table} f ${where}
        ORDER BY f.updated_at DESC,f.${key} LIMIT $4 OFFSET $5`,
        [...args, q.pageSize, (q.page - 1) * q.pageSize]
      ),
    ])
    return libraryListSchema.parse({
      items: result.rows.map((r) => this.record(r)),
      page: q.page,
      pageSize: q.pageSize,
      total: count.rows[0].n,
    })
  }
  async detail(kind: Kind, id: string) {
    const { table, key } = this.config(kind)
    const { rows } = await this.pool.query(
      `SELECT f.${key}::text AS id,f.data,f.updated_at,${this.sources.replace('%KEY%', key)}
      FROM catalog_v2.${table} f WHERE f.${key}::text=$2`,
      [kind, id]
    )
    const row = rows[0]
    if (!row) throw new NotFoundException('记录不存在')
    return libraryDetailSchema.parse({
      ...this.record(row),
      abstract: row.data.abstract ?? null,
      claims: row.data.claims ?? null,
      description: row.data.description ?? null,
      cpcs: row.data.cpcs ?? [],
      businessInfo: row.data.fields ?? {},
      // v2 keeps Agent-inferred ownership inside each research run, never globally.
      relations: [],
    })
  }
}
