import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { registerSchema } from '@tech-scout/contracts'
import { argon2id, hash } from 'argon2'
import { assertUsernameAllowed } from '../auth/auth.service.js'
import { PrismaService } from '../database/prisma.service.js'

if (existsSync(new URL('../../.env', import.meta.url))) {
  loadEnvFile(new URL('../../.env', import.meta.url))
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const parsed = registerSchema.safeParse({
  username: argument('username'),
  email: argument('email'),
  password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
})
if (!parsed.success) {
  process.stderr.write(
    '用法：设置 ADMIN_BOOTSTRAP_PASSWORD 后传入 --username 和 --email。\n'
  )
  process.exitCode = 1
} else {
  const prisma = new PrismaService()
  try {
    assertUsernameAllowed(parsed.data.username)
    const activeAdmins = await prisma.userAccount.count({
      where: { role: 'admin', status: 'active' },
    })
    if (activeAdmins > 0) {
      throw new Error(
        '系统已经存在启用的管理员，请通过用户管理页面提升其他用户。'
      )
    }
    await prisma.userAccount.create({
      data: {
        username: parsed.data.username,
        email: parsed.data.email,
        normalizedEmail: parsed.data.email.toLowerCase(),
        passwordHash: await hash(parsed.data.password, { type: argon2id }),
        role: 'admin',
      },
    })
    process.stdout.write('首个管理员已创建。\n')
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : '创建失败'}\n`
    )
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}
