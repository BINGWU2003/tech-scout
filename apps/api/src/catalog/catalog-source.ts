import { basename } from 'node:path'
import { type CatalogSourceReference } from '@tech-scout/contracts'

type SourceRecord = {
  id: string
  dataset: string
  sourcePath: string
  sourceRowNumber: string | number
  sourceSha256: string
  sourceRelease: string
  url?: string | null
}

export function sourceReference(record: SourceRecord): CatalogSourceReference {
  return {
    locator: Buffer.from(`${record.dataset}:${record.id}`).toString(
      'base64url'
    ),
    dataset: record.dataset,
    relativePath: logicalSourcePath(record.sourcePath),
    sourceRowNumber: Number(record.sourceRowNumber),
    sha256: record.sourceSha256.trim(),
    sourceRelease: record.sourceRelease,
    url: record.url ?? null,
  }
}

export function decodeSourceLocator(
  locator: string
): { dataset: string; id: string } | null {
  try {
    const value = Buffer.from(locator, 'base64url').toString('utf8')
    const separator = value.indexOf(':')
    if (separator <= 0 || separator === value.length - 1) return null
    return {
      dataset: value.slice(0, separator),
      id: value.slice(separator + 1),
    }
  } catch {
    return null
  }
}

function logicalSourcePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/')
  if (!/^[A-Za-z]:\//.test(normalized) && !normalized.startsWith('/')) {
    return normalized
  }
  for (const marker of ['/reviews/', '/silver/', '/bronze/', '/releases/']) {
    const position = normalized.toLowerCase().indexOf(marker)
    if (position >= 0) return normalized.slice(position + 1)
  }
  return basename(normalized) || null
}
