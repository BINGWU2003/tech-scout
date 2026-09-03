import { CatalogDatabase } from './catalog.database.js'
import { CatalogRepository } from './catalog.repository.js'

const runCatalogTests = Boolean(process.env.CATALOG_DATABASE_URL)
const describeWithCatalog = runCatalogTests ? describe : describe.skip

describeWithCatalog('CatalogRepository', () => {
  let database: CatalogDatabase

  beforeAll(async () => {
    database = new CatalogDatabase()
  })

  afterAll(async () => {
    await database.onModuleDestroy()
  })

  it('returns the latest published release without internal paths', async () => {
    const repository = new CatalogRepository(database)

    const release = await repository.currentRelease()

    expect(release).toMatchObject({
      releaseId: '2026-09-v6',
      dataset: 'ai-domains',
      periodFromYear: 2019,
      periodToYear: 2025,
    })
    expect(release).not.toHaveProperty('manifestPath')
    expect(release).not.toHaveProperty('manifest')
  })

  it('lists current domains with deterministic patent counts', async () => {
    const repository = new CatalogRepository(database)

    const result = await repository.listDomains()

    expect(result.release.releaseId).toBe('2026-09-v6')
    expect(
      result.items.map(({ domainId, patentCount }) => ({
        domainId,
        patentCount,
      }))
    ).toEqual([
      { domainId: 'ai_chips_edge_inference', patentCount: 1882 },
      {
        domainId: 'industrial_vision_quality_inspection',
        patentCount: 981,
      },
    ])
  })
})
