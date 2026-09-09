import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@hey-api/openapi-ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'tech-scout-contract-'))
async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const name = path.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...(await files(directory, name)))
    else result.push(name)
  }
  return result.sort()
}
try {
  await createClient({
    input: path.resolve(root, '../../services/research/openapi.json'),
    output: { path: temporary, importFileExtension: '.js' },
  })
  const checkedIn = path.join(root, 'src/generated/intelligence')
  const generatedFiles = await files(temporary)
  if (JSON.stringify(generatedFiles) !== JSON.stringify(await files(checkedIn)))
    throw new Error('生成客户端文件列表漂移')
  for (const name of generatedFiles) {
    const expected = (
      await readFile(path.join(temporary, name), 'utf8')
    ).replaceAll('\r\n', '\n')
    const actual = (
      await readFile(path.join(checkedIn, name), 'utf8')
    ).replaceAll('\r\n', '\n')
    if (actual !== expected) throw new Error(`内部客户端有漂移：${name}`)
  }
  process.stdout.write('Intelligence client is current\n')
} finally {
  // Only remove the exact directory returned by mkdtemp above.
  if (
    path.dirname(temporary) === path.resolve(tmpdir()) &&
    path.basename(temporary).startsWith('tech-scout-contract-')
  ) {
    await rm(temporary, { recursive: true })
  }
}
