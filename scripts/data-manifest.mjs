/* eslint-disable no-console -- This file implements an interactive CLI. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG_PATH = resolve(SCRIPT_DIR, '../config/data-sources.json')
const INVENTORY_DIRECTORIES = ['raw', 'patents', 'company']
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function toPosixPath(value) {
  return value.split(sep).join('/')
}

function normalizeRelativePath(value, field = 'path') {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error(`${field} must be a non-empty relative path: ${value}`)
  }

  const normalized = toPosixPath(value).replace(/^\.\//, '')
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${field} must stay inside the data root: ${value}`)
  }

  return normalized
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function validateSourceConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Source config must be a JSON object')
  }
  if (!config.datasets || typeof config.datasets !== 'object') {
    throw new Error('Source config must define datasets')
  }
  if (!Array.isArray(config.files) || config.files.length === 0) {
    throw new Error('Source config must define at least one file')
  }

  const registeredPaths = new Map()
  for (const file of config.files) {
    file.path = normalizeRelativePath(file.path)
    if (registeredPaths.has(file.path)) {
      throw new Error(`Duplicate registered path: ${file.path}`)
    }
    if (!config.datasets[file.dataset]) {
      throw new Error(`Unknown dataset ${file.dataset} for ${file.path}`)
    }
    if (!['raw', 'extracted'].includes(file.role)) {
      throw new Error(`Invalid role for ${file.path}: ${file.role}`)
    }
    if (!file.format || !file.compression) {
      throw new Error(`Missing format or compression for ${file.path}`)
    }
    if (file.archivePath) {
      file.archivePath = normalizeRelativePath(file.archivePath, 'archivePath')
      if (!file.archiveMember) {
        throw new Error(`Missing archiveMember for ${file.path}`)
      }
    }
    registeredPaths.set(file.path, file)
  }

  for (const file of config.files) {
    if (!file.archivePath) continue
    const archive = registeredPaths.get(file.archivePath)
    if (!archive || archive.role !== 'raw' || archive.compression !== 'zip') {
      throw new Error(
        `Archive for ${file.path} is not a registered raw ZIP: ${file.archivePath}`
      )
    }
  }

  const referencedArchives = new Set(
    config.files.map((file) => file.archivePath).filter(Boolean)
  )
  for (const file of config.files) {
    if (
      file.role === 'raw' &&
      file.compression === 'zip' &&
      !referencedArchives.has(file.path)
    ) {
      throw new Error(
        `Raw ZIP has no registered extracted member: ${file.path}`
      )
    }
  }

  return config
}

async function listFilesRecursively(root, directory) {
  const absoluteDirectory = join(root, directory)
  let entries
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Required data directory is missing: ${directory}`)
    }
    throw error
  }

  const paths = []
  for (const entry of entries) {
    const absolutePath = join(absoluteDirectory, entry.name)
    if (entry.isDirectory()) {
      const childDirectory = toPosixPath(relative(root, absolutePath))
      paths.push(...(await listFilesRecursively(root, childDirectory)))
    } else if (entry.isFile()) {
      paths.push(toPosixPath(relative(root, absolutePath)))
    }
  }
  return paths
}

async function validateInventory(dataRoot, expectedPaths) {
  const actualPaths = (
    await Promise.all(
      INVENTORY_DIRECTORIES.map((directory) =>
        listFilesRecursively(dataRoot, directory)
      )
    )
  )
    .flat()
    .sort()
  const expected = [...expectedPaths].sort()
  const actualSet = new Set(actualPaths)
  const expectedSet = new Set(expected)
  const missing = expected.filter((path) => !actualSet.has(path))
  const unexpected = actualPaths.filter((path) => !expectedSet.has(path))

  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `Missing files:\n- ${missing.join('\n- ')}` : null,
      unexpected.length
        ? `Unexpected files:\n- ${unexpected.join('\n- ')}`
        : null,
    ].filter(Boolean)
    throw new Error(
      `Data inventory does not match the registry.\n${details.join('\n')}`
    )
  }
}

async function sha256File(path) {
  const before = await stat(path)
  if (!before.isFile() || before.size <= 0) {
    throw new Error(`File is empty or is not a regular file: ${path}`)
  }

  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }

  const after = await stat(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`File changed while hashing: ${path}`)
  }

  return {
    sha256: hash.digest('hex'),
    sizeBytes: after.size,
    observedMtimeUtc: after.mtime.toISOString(),
  }
}

function validateContentGroups(files) {
  const groups = new Map()
  for (const file of files) {
    if (!file.contentGroup) continue
    const hashes = groups.get(file.contentGroup) ?? []
    hashes.push({ path: file.path, sha256: file.sha256 })
    groups.set(file.contentGroup, hashes)
  }

  for (const [group, members] of groups) {
    if (members.length < 2) {
      throw new Error(`Content group ${group} must contain at least two files`)
    }
    if (new Set(members.map((member) => member.sha256)).size !== 1) {
      throw new Error(
        `Content group ${group} does not match: ${members
          .map((member) => member.path)
          .join(', ')}`
      )
    }
  }
}

function validateManifestStructure(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be a JSON object')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Manifest does not contain files')
  }
  if (manifest.fileCount !== manifest.files.length) {
    throw new Error('Manifest fileCount does not match files.length')
  }

  const paths = new Set()
  for (const file of manifest.files) {
    file.path = normalizeRelativePath(file.path)
    if (paths.has(file.path)) {
      throw new Error(`Duplicate path in manifest: ${file.path}`)
    }
    if (!SHA256_PATTERN.test(file.sha256)) {
      throw new Error(`Invalid SHA-256 for ${file.path}`)
    }
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) {
      throw new Error(`Invalid size for ${file.path}`)
    }
    if (file.archive) {
      file.archive.path = normalizeRelativePath(
        file.archive.path,
        'archive.path'
      )
      if (!file.archive.member) {
        throw new Error(`Missing archive member for ${file.path}`)
      }
    }
    paths.add(file.path)
  }

  for (const file of manifest.files) {
    if (file.archive && !paths.has(file.archive.path)) {
      throw new Error(
        `Manifest archive for ${file.path} is missing: ${file.archive.path}`
      )
    }
  }
  validateContentGroups(manifest.files)
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, contents, 'utf8')
  await rename(temporaryPath, path)
}

export async function generateManifest({
  dataRoot,
  snapshot,
  configPath = DEFAULT_CONFIG_PATH,
  outputDirectory,
  onProgress = () => {},
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot ?? '')) {
    throw new Error('snapshot must use YYYY-MM-DD format')
  }

  const absoluteDataRoot = resolve(dataRoot)
  const absoluteConfigPath = resolve(configPath)
  const config = validateSourceConfig(await readJson(absoluteConfigPath))
  await validateInventory(
    absoluteDataRoot,
    config.files.map((file) => file.path)
  )

  const manifestFiles = []
  const sortedFiles = [...config.files].sort((left, right) =>
    left.path.localeCompare(right.path)
  )
  for (const [index, file] of sortedFiles.entries()) {
    onProgress({
      current: index + 1,
      total: sortedFiles.length,
      path: file.path,
    })
    const dataset = config.datasets[file.dataset]
    const fingerprint = await sha256File(join(absoluteDataRoot, file.path))
    manifestFiles.push({
      provider: dataset.provider,
      dataset: file.dataset,
      datasetName: dataset.name,
      role: file.role,
      path: file.path,
      sizeBytes: fingerprint.sizeBytes,
      sha256: fingerprint.sha256,
      format: file.format,
      compression: file.compression,
      sourceUrl: dataset.sourceUrl,
      publishedAt: dataset.publishedAt,
      downloadedAt: null,
      observedMtimeUtc: fingerprint.observedMtimeUtc,
      dataCoverage: file.dataCoverage ?? null,
      schemaVersion: dataset.schemaVersion,
      license: dataset.license,
      archive: file.archivePath
        ? { path: file.archivePath, member: file.archiveMember }
        : null,
      contentGroup: file.contentGroup ?? null,
    })
  }

  validateContentGroups(manifestFiles)
  const release = `source-${snapshot}`
  const manifest = {
    schemaVersion: config.schemaVersion,
    release,
    snapshot,
    generatedAt: new Date().toISOString(),
    dataRoot: absoluteDataRoot,
    fileCount: manifestFiles.length,
    rawFileCount: manifestFiles.filter((file) => file.role === 'raw').length,
    extractedFileCount: manifestFiles.filter(
      (file) => file.role === 'extracted'
    ).length,
    totalSizeBytes: manifestFiles.reduce(
      (total, file) => total + file.sizeBytes,
      0
    ),
    files: manifestFiles,
  }
  validateManifestStructure(manifest)

  const absoluteOutputDirectory = resolve(
    outputDirectory ?? join(absoluteDataRoot, 'releases', release)
  )
  const manifestPath = join(absoluteOutputDirectory, 'manifest.json')
  const checksumsPath = join(absoluteOutputDirectory, 'SHA256SUMS.txt')
  const checksums = manifestFiles
    .map((file) => `${file.sha256}  ${file.path}`)
    .join('\n')

  await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeAtomic(checksumsPath, `${checksums}\n`)

  return { manifest, manifestPath, checksumsPath }
}

export async function verifyManifest({
  manifestPath,
  dataRoot,
  onProgress = () => {},
}) {
  const absoluteManifestPath = resolve(manifestPath)
  const manifest = await readJson(absoluteManifestPath)
  validateManifestStructure(manifest)
  const absoluteDataRoot = resolve(dataRoot ?? manifest.dataRoot)
  await validateInventory(
    absoluteDataRoot,
    manifest.files.map((file) => file.path)
  )

  for (const [index, file] of manifest.files.entries()) {
    onProgress({
      current: index + 1,
      total: manifest.files.length,
      path: file.path,
    })
    const absolutePath = join(absoluteDataRoot, file.path)
    const currentStat = await stat(absolutePath)
    if (currentStat.size !== file.sizeBytes) {
      throw new Error(
        `Size mismatch for ${file.path}: expected ${file.sizeBytes}, got ${currentStat.size}`
      )
    }
    const fingerprint = await sha256File(absolutePath)
    if (fingerprint.sha256 !== file.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${fingerprint.sha256}`
      )
    }
  }

  validateContentGroups(manifest.files)
  return { manifest, manifestPath: absoluteManifestPath }
}

function parseArguments(argv) {
  const command = argv[0]
  const options = {}
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }
    const key = argument.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`)
    }
    options[key] = value
    index += 1
  }
  return { command, options }
}

function printUsage() {
  console.log(`Usage:
  pnpm data:manifest generate --data-root <path> --snapshot <YYYY-MM-DD> [--config <path>] [--output-dir <path>]
  pnpm data:manifest verify --manifest <path> [--data-root <path>]`)
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2))
  const onProgress = ({ current, total, path }) => {
    console.log(`[${current}/${total}] ${path}`)
  }

  if (command === 'generate') {
    if (!options['data-root'] || !options.snapshot) {
      printUsage()
      throw new Error('generate requires --data-root and --snapshot')
    }
    const result = await generateManifest({
      dataRoot: options['data-root'],
      snapshot: options.snapshot,
      configPath: options.config,
      outputDirectory: options['output-dir'],
      onProgress,
    })
    console.log(`Manifest written: ${result.manifestPath}`)
    console.log(`Checksums written: ${result.checksumsPath}`)
    return
  }

  if (command === 'verify') {
    if (!options.manifest) {
      printUsage()
      throw new Error('verify requires --manifest')
    }
    const result = await verifyManifest({
      manifestPath: options.manifest,
      dataRoot: options['data-root'],
      onProgress,
    })
    console.log(
      `Verified ${result.manifest.fileCount} files: ${result.manifestPath}`
    )
    return
  }

  printUsage()
  throw new Error(`Unknown command: ${command ?? '(none)'}`)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
