import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { generateManifest, verifyManifest } from './data-manifest.mjs'

async function createFixture() {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'tech-scout-manifest-')
  )
  const dataRoot = join(temporaryDirectory, 'data')
  await Promise.all(
    ['raw', 'patents', 'company'].map((directory) =>
      mkdir(join(dataRoot, directory), { recursive: true })
    )
  )
  await writeFile(join(dataRoot, 'raw', 'sample.zip'), 'archive')
  await writeFile(join(dataRoot, 'patents', 'sample.txt'), 'alpha')
  await writeFile(join(dataRoot, 'company', 'source.json'), '{}')

  const configPath = join(temporaryDirectory, 'sources.json')
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: '1.0.0',
      datasets: {
        sample: {
          provider: 'Example',
          name: 'Fixture data',
          sourceUrl: 'https://example.com/data',
          publishedAt: null,
          schemaVersion: null,
          license: { status: 'not_recorded', note: 'Test fixture' },
        },
      },
      files: [
        {
          dataset: 'sample',
          role: 'raw',
          path: 'raw/sample.zip',
          format: 'txt',
          compression: 'zip',
          dataCoverage: null,
        },
        {
          dataset: 'sample',
          role: 'extracted',
          path: 'patents/sample.txt',
          format: 'txt',
          compression: 'none',
          dataCoverage: null,
          archivePath: 'raw/sample.zip',
          archiveMember: 'sample.txt',
        },
        {
          dataset: 'sample',
          role: 'raw',
          path: 'company/source.json',
          format: 'json',
          compression: 'none',
          dataCoverage: null,
        },
      ],
    })
  )
  return { temporaryDirectory, dataRoot, configPath }
}

test('generates and verifies a stable source manifest', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.temporaryDirectory, { recursive: true }))

  const first = await generateManifest({
    dataRoot: fixture.dataRoot,
    snapshot: '2026-09-02',
    configPath: fixture.configPath,
  })
  assert.equal(first.manifest.fileCount, 3)
  assert.equal(first.manifest.rawFileCount, 2)
  assert.equal(first.manifest.extractedFileCount, 1)
  assert.ok(
    first.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))
  )
  assert.ok(first.manifest.files.every((file) => file.downloadedAt === null))
  await verifyManifest({ manifestPath: first.manifestPath })

  const firstHashes = first.manifest.files.map(({ path, sha256 }) => ({
    path,
    sha256,
  }))
  const second = await generateManifest({
    dataRoot: fixture.dataRoot,
    snapshot: '2026-09-02',
    configPath: fixture.configPath,
  })
  assert.deepEqual(
    second.manifest.files.map(({ path, sha256 }) => ({ path, sha256 })),
    firstHashes
  )
  assert.deepEqual(await readdir(join(fixture.dataRoot, 'releases')), [
    'source-2026-09-02',
  ])

  const persisted = JSON.parse(await readFile(second.manifestPath, 'utf8'))
  assert.equal(persisted.fileCount, 3)
})

test('verification rejects changed and missing files', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.temporaryDirectory, { recursive: true }))
  const result = await generateManifest({
    dataRoot: fixture.dataRoot,
    snapshot: '2026-09-02',
    configPath: fixture.configPath,
  })

  await writeFile(join(fixture.dataRoot, 'patents', 'sample.txt'), 'bravo')
  await assert.rejects(
    verifyManifest({ manifestPath: result.manifestPath }),
    /SHA-256 mismatch/
  )

  await rm(join(fixture.dataRoot, 'patents', 'sample.txt'))
  await assert.rejects(
    verifyManifest({ manifestPath: result.manifestPath }),
    /Missing files/
  )
})

test('generation rejects files that are not registered', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.temporaryDirectory, { recursive: true }))
  await writeFile(join(fixture.dataRoot, 'company', 'unexpected.csv'), 'value')

  await assert.rejects(
    generateManifest({
      dataRoot: fixture.dataRoot,
      snapshot: '2026-09-02',
      configPath: fixture.configPath,
    }),
    /Unexpected files/
  )
})
