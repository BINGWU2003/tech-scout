import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  type ResetPasswordResponse,
  type User,
  type UserList,
  type UserListQuery,
  type UserRole,
  type UserStatus,
} from '@tech-scout/contracts'
import { argon2id, hash } from 'argon2'
import { publicUser } from '../auth/auth.service.js'
import { PrismaService } from '../database/prisma.service.js'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UserListQuery): Promise<UserList> {
    const where = {
      ...(query.search
        ? {
            OR: [
              { username: { contains: query.search.toLowerCase() } },
              {
                normalizedEmail: {
                  contains: query.search.toLowerCase(),
                },
              },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAccount.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.userAccount.count({ where }),
    ])
    return {
      items: items.map(publicUser),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    }
  }

  async updateRole(
    actorId: string,
    targetId: string,
    role: UserRole
  ): Promise<User> {
    if (actorId === targetId) {
      throw new BadRequestException({
        code: 'SELF_ADMIN_CHANGE_FORBIDDEN',
        message: '不能修改自己的管理员角色',
      })
    }
    return this.prisma.$transaction(
      async (database) => {
        const target = await database.userAccount.findUnique({
          where: { id: targetId },
        })
        if (!target) this.notFound()
        if (
          target.role === 'admin' &&
          target.status === 'active' &&
          role !== 'admin'
        ) {
          await this.assertAnotherActiveAdmin(database, target.id)
        }
        return publicUser(
          await database.userAccount.update({
            where: { id: targetId },
            data: { role },
          })
        )
      },
      { isolationLevel: 'Serializable' }
    )
  }

  async updateStatus(
    actorId: string,
    targetId: string,
    status: UserStatus
  ): Promise<User> {
    if (actorId === targetId && status === 'disabled') {
      throw new BadRequestException({
        code: 'SELF_DISABLE_FORBIDDEN',
        message: '不能禁用自己的账号',
      })
    }
    return this.prisma.$transaction(
      async (database) => {
        const target = await database.userAccount.findUnique({
          where: { id: targetId },
        })
        if (!target) this.notFound()
        if (
          target.role === 'admin' &&
          target.status === 'active' &&
          status === 'disabled'
        ) {
          await this.assertAnotherActiveAdmin(database, target.id)
        }
        const updated = await database.userAccount.update({
          where: { id: targetId },
          data: { status },
        })
        if (status === 'disabled') {
          await database.userSession.deleteMany({ where: { userId: targetId } })
        }
        return publicUser(updated)
      },
      { isolationLevel: 'Serializable' }
    )
  }

  async resetPassword(
    actorId: string,
    targetId: string
  ): Promise<ResetPasswordResponse> {
    if (actorId === targetId) {
      throw new BadRequestException({
        code: 'SELF_PASSWORD_RESET_FORBIDDEN',
        message: '请通过个人设置修改自己的密码',
      })
    }
    const target = await this.prisma.userAccount.findUnique({
      where: { id: targetId },
      select: { id: true },
    })
    if (!target) this.notFound()
    const password = randomBytes(18).toString('base64url')
    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: targetId },
        data: { passwordHash: await hash(password, { type: argon2id }) },
      }),
      this.prisma.userSession.deleteMany({ where: { userId: targetId } }),
    ])
    return { password }
  }

  async revokeSessions(targetId: string): Promise<void> {
    const target = await this.prisma.userAccount.findUnique({
      where: { id: targetId },
      select: { id: true },
    })
    if (!target) this.notFound()
    await this.prisma.userSession.deleteMany({ where: { userId: targetId } })
  }

  private async assertAnotherActiveAdmin(
    database: Pick<PrismaService, 'userAccount'>,
    excludedId: string
  ): Promise<void> {
    const count = await database.userAccount.count({
      where: {
        id: { not: excludedId },
        role: 'admin',
        status: 'active',
      },
    })
    if (count === 0) {
      throw new BadRequestException({
        code: 'LAST_ADMIN_REQUIRED',
        message: '系统必须保留至少一个启用的管理员',
      })
    }
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'USER_NOT_FOUND',
      message: '用户不存在',
    })
  }
}
