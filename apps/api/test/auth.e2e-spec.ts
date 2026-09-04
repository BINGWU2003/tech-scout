import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { argon2id, hash } from 'argon2'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/app.setup.js'
import { PrismaService } from '../src/database/prisma.service.js'

const runDatabaseTests = Boolean(process.env.TEST_DATABASE_URL)
const describeWithDatabase = runDatabaseTests ? describe : describe.skip

describeWithDatabase('认证与用户管理（端到端）', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.CATALOG_DATABASE_URL =
      process.env.TEST_CATALOG_DATABASE_URL ?? process.env.TEST_DATABASE_URL
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_COOKIE_SECURE = 'false'
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await prisma.userSession.deleteMany()
    await prisma.userAccount.deleteMany()
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it('注册、规范化并恢复会话', async () => {
    const agent = request.agent(app.getHttpServer())
    const registered = await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'Alice_01',
        email: 'Alice@Example.COM',
        password: 'correct horse battery staple',
      })
      .expect(201)

    expect(registered.body.user).toMatchObject({
      username: 'alice_01',
      email: 'Alice@Example.COM',
      role: 'user',
      status: 'active',
    })
    expect(registered.body).not.toHaveProperty('emailVerified')
    expect(registered.headers['set-cookie'][0]).toContain('HttpOnly')

    const me = await agent.get('/api/v1/auth/me').expect(200)
    expect(me.body.user.id).toBe(registered.body.user.id)
    expect(me.body.csrfToken).toHaveLength(43)
  })

  it('使用用户名或邮箱登录并通过 CSRF 保护写操作', async () => {
    const first = request.agent(app.getHttpServer())
    const registration = await first
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'researcher',
        email: 'researcher@example.com',
        password: 'first secure password',
      })
      .expect(201)
    await first
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', registration.body.csrfToken)
      .expect(204)

    for (const identifier of ['researcher', 'researcher@example.com']) {
      const agent = request.agent(app.getHttpServer())
      const login = await agent
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .send({ identifier, password: 'first secure password' })
        .expect(200)
      await agent
        .patch('/api/v1/auth/password')
        .set('Origin', 'http://localhost:5173')
        .send({
          currentPassword: 'first secure password',
          newPassword: 'another secure password',
        })
        .expect(401)
      await agent
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', login.body.csrfToken)
        .expect(204)
    }
  })

  it('拒绝保留或重复身份，并禁止普通用户访问管理员 API', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'admin',
        email: 'reserved@example.com',
        password: 'a secure registration password',
      })
      .expect(400)

    const user = request.agent(app.getHttpServer())
    await user
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'duplicate_user',
        email: 'Original@Example.com',
        password: 'a secure registration password',
      })
      .expect(201)
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'another_user',
        email: 'original@example.COM',
        password: 'another secure password',
      })
      .expect(409)
    expect(duplicate.body.code).toBe('EMAIL_TAKEN')
    await user.get('/api/v1/admin/users').expect(403)
  })

  it('允许管理员禁用、恢复和重置用户', async () => {
    await prisma.userAccount.create({
      data: {
        username: 'owner_admin',
        email: 'owner@example.com',
        normalizedEmail: 'owner@example.com',
        passwordHash: await hash('admin secure password', { type: argon2id }),
        role: 'admin',
      },
    })
    const regular = await prisma.userAccount.create({
      data: {
        username: 'regular_user',
        email: 'regular@example.com',
        normalizedEmail: 'regular@example.com',
        passwordHash: await hash('regular secure password', { type: argon2id }),
      },
    })
    const admin = request.agent(app.getHttpServer())
    const login = await admin
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ identifier: 'owner_admin', password: 'admin secure password' })
      .expect(200)

    const list = await admin
      .get('/api/v1/admin/users?page=1&pageSize=20')
      .expect(200)
    expect(list.body.total).toBe(2)

    await admin
      .patch(`/api/v1/admin/users/${regular.id}/role`)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', login.body.csrfToken)
      .send({ role: 'admin' })
      .expect(200)
    await admin
      .patch(`/api/v1/admin/users/${regular.id}/role`)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', login.body.csrfToken)
      .send({ role: 'user' })
      .expect(200)

    await admin
      .patch(`/api/v1/admin/users/${regular.id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', login.body.csrfToken)
      .send({ status: 'disabled' })
      .expect(200)
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ identifier: 'regular_user', password: 'regular secure password' })
      .expect(401)

    await admin
      .patch(`/api/v1/admin/users/${regular.id}/status`)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', login.body.csrfToken)
      .send({ status: 'active' })
      .expect(200)
    const reset = await admin
      .post(`/api/v1/admin/users/${regular.id}/reset-password`)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', login.body.csrfToken)
      .expect(201)
    expect(reset.body.password).toHaveLength(24)
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ identifier: 'regular_user', password: reset.body.password })
      .expect(200)
  })
})
