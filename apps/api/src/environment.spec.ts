import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  databaseUrl,
  loadDatabaseEnvironment,
  loadServiceEnvironment,
} from './environment.js'

describe('共享数据库配置', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tech-scout-env-'))
  const root = pathToFileURL(join(directory, 'root.env'))
  const service = pathToFileURL(join(directory, 'service.env'))

  beforeAll(() => {
    writeFileSync(root, 'DATABASE_URL=postgresql://root/example\nPORT=1234\n')
    writeFileSync(
      service,
      'DATABASE_URL=postgresql://service/example\nPORT=4567\n'
    )
  })
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('PORT', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(() => {
    unlinkSync(root)
    unlinkSync(service)
    rmdirSync(directory)
  })

  it('只从根配置加载数据库，服务配置仍加载其他字段', () => {
    loadServiceEnvironment(service)
    expect(process.env.DATABASE_URL).toBeUndefined()
    loadDatabaseEnvironment(root)
    expect(databaseUrl()).toBe('postgresql://root/example')
    expect(process.env.PORT).toBe('4567')
  })

  it('进程环境优先于两个配置文件', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://process/example')
    vi.stubEnv('PORT', '9999')
    loadDatabaseEnvironment(root)
    loadServiceEnvironment(service)
    expect(databaseUrl()).toBe('postgresql://process/example')
    expect(process.env.PORT).toBe('9999')
  })

  it('缺少根连接时明确失败，不从服务配置回退', () => {
    loadDatabaseEnvironment(pathToFileURL(join(directory, 'missing.env')))
    loadServiceEnvironment(service)
    expect(databaseUrl).toThrow('DATABASE_URL is required')
  })
})
