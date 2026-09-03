import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import {
  type AuthSession,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type User,
} from '@tech-scout/contracts'
import { argon2id, hash, verify } from 'argon2'
import { PrismaService } from '../database/prisma.service.js'
import {
  type UserAccount,
  type UserSession,
} from '../generated/prisma/client.js'

export const SESSION_COOKIE = 'tech_scout_session'
const IDLE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000
const ABSOLUTE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000
const MAX_SESSIONS = 10
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'root',
  'support',
  'system',
  'tech-scout',
])

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function secret(): string {
  return randomBytes(32).toString('base64url')
}

export function assertUsernameAllowed(username: string): void {
  if (RESERVED_USERNAMES.has(username)) {
    throw new BadRequestException({
      code: 'USERNAME_RESERVED',
      message: '该用户名不可注册',
    })
  }
}

export function publicUser(user: UserAccount): User {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    input: RegisterInput
  ): Promise<{ response: AuthSession; token: string }> {
    assertUsernameAllowed(input.username)
    const normalizedEmail = input.email.toLowerCase()
    const existing = await this.prisma.userAccount.findFirst({
      where: {
        OR: [{ username: input.username }, { normalizedEmail }],
      },
      select: { username: true, normalizedEmail: true },
    })
    if (existing?.username === input.username) {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: '用户名已被使用',
      })
    }
    if (existing?.normalizedEmail === normalizedEmail) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: '邮箱已被使用',
      })
    }

    let user: UserAccount
    try {
      user = await this.prisma.userAccount.create({
        data: {
          username: input.username,
          email: input.email,
          normalizedEmail,
          passwordHash: await hash(input.password, { type: argon2id }),
        },
      })
    } catch (error) {
      const databaseError = error as {
        code?: string
        meta?: { target?: string[] | string }
      }
      if (databaseError.code !== 'P2002') throw error
      const target = Array.isArray(databaseError.meta?.target)
        ? databaseError.meta.target.join(',')
        : (databaseError.meta?.target ?? '')
      if (target.includes('username')) {
        throw new ConflictException({
          code: 'USERNAME_TAKEN',
          message: '用户名已被使用',
        })
      }
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: '邮箱已被使用',
      })
    }
    return this.createSession(user)
  }

  async login(
    input: LoginInput
  ): Promise<{ response: AuthSession; token: string }> {
    const identifier = input.identifier.trim().toLowerCase()
    const user = await this.prisma.userAccount.findFirst({
      where: identifier.includes('@')
        ? { normalizedEmail: identifier }
        : { username: identifier },
    })
    if (
      !user ||
      user.status !== 'active' ||
      !(await verify(user.passwordHash, input.password))
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '用户名/邮箱或密码错误',
      })
    }
    const updated = await this.prisma.userAccount.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    return this.createSession(updated)
  }

  async authenticate(token: string | undefined): Promise<{
    user: UserAccount
    session: UserSession
  }> {
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: '请先登录',
      })
    }
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    })
    const now = new Date()
    if (
      !session ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.user.status !== 'active'
    ) {
      if (session) {
        await this.prisma.userSession.delete({ where: { id: session.id } })
      }
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: '登录状态已失效',
      })
    }

    const nextIdle = new Date(
      Math.min(
        now.getTime() + IDLE_MILLISECONDS,
        session.absoluteExpiresAt.getTime()
      )
    )
    const updated = await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now, idleExpiresAt: nextIdle },
    })
    return { user: session.user, session: updated }
  }

  async refresh(user: UserAccount, session: UserSession): Promise<AuthSession> {
    const csrfToken = secret()
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { csrfTokenHash: digest(csrfToken) },
    })
    return { user: publicUser(user), csrfToken }
  }

  verifyCsrf(session: UserSession, token: string | undefined): void {
    if (!token) {
      throw new UnauthorizedException({
        code: 'CSRF_TOKEN_INVALID',
        message: '请求验证失败',
      })
    }
    const expected = Buffer.from(session.csrfTokenHash, 'hex')
    const actual = Buffer.from(digest(token), 'hex')
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException({
        code: 'CSRF_TOKEN_INVALID',
        message: '请求验证失败',
      })
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { id: sessionId } })
  }

  async changePassword(
    user: UserAccount,
    session: UserSession,
    input: ChangePasswordInput
  ): Promise<AuthSession> {
    if (!(await verify(user.passwordHash, input.currentPassword))) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INVALID',
        message: '当前密码错误',
      })
    }
    if (await verify(user.passwordHash, input.newPassword)) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: '新密码不能与当前密码相同',
      })
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: user.id },
        data: {
          passwordHash: await hash(input.newPassword, { type: argon2id }),
        },
      }),
      this.prisma.userSession.deleteMany({
        where: { userId: user.id, id: { not: session.id } },
      }),
    ])
    return this.refresh(updated, session)
  }

  private async createSession(
    user: UserAccount
  ): Promise<{ response: AuthSession; token: string }> {
    const token = secret()
    const csrfToken = secret()
    const now = new Date()
    const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_MILLISECONDS)
    await this.prisma.$transaction(async (database) => {
      await database.userSession.deleteMany({
        where: {
          userId: user.id,
          OR: [
            { idleExpiresAt: { lte: now } },
            { absoluteExpiresAt: { lte: now } },
          ],
        },
      })
      const active = await database.userSession.findMany({
        where: { userId: user.id },
        orderBy: { lastSeenAt: 'asc' },
        select: { id: true },
      })
      if (active.length >= MAX_SESSIONS) {
        await database.userSession.deleteMany({
          where: {
            id: {
              in: active
                .slice(0, active.length - MAX_SESSIONS + 1)
                .map(({ id }) => id),
            },
          },
        })
      }
      return database.userSession.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          csrfTokenHash: digest(csrfToken),
          idleExpiresAt: new Date(now.getTime() + IDLE_MILLISECONDS),
          absoluteExpiresAt,
        },
      })
    })
    return {
      token,
      response: { user: publicUser(user), csrfToken },
    }
  }
}
