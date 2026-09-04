import { Controller, Get, type INestApplication, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { z } from 'zod'
import { ApiExceptionFilter } from './api-exception.filter.js'
import { ZodResponse } from './zod-response.decorator.js'
import { ZodResponseInterceptor } from './zod-response.interceptor.js'

const responseSchema = z.object({
  value: z.string().transform((value) => value.trim()),
})

@Controller()
class ResponseTestController {
  @Get('valid')
  @ZodResponse(responseSchema)
  valid(): unknown {
    return { value: ' 保持原值 ' }
  }

  @Get('invalid')
  @ZodResponse(responseSchema)
  invalid(): unknown {
    return { value: 42 }
  }

  @Get('unvalidated')
  unvalidated(): unknown {
    return { value: 42 }
  }
}

@Module({
  controllers: [ResponseTestController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: ZodResponseInterceptor }],
})
class ResponseTestModule {}

describe('Zod 响应拦截器', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ResponseTestModule],
    }).compile()
    app = module.createNestApplication()
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('返回符合契约的原始响应而不应用 schema transform', async () => {
    const response = await request(app.getHttpServer())
      .get('/valid')
      .expect(200)

    expect(response.body).toEqual({ value: ' 保持原值 ' })
  })

  it('将不符合契约的响应转换为稳定的 500 错误', async () => {
    const response = await request(app.getHttpServer())
      .get('/invalid')
      .expect(500)

    expect(response.body).toEqual({
      code: 'RESPONSE_VALIDATION_ERROR',
      message: '服务器响应校验失败',
      requestId: expect.any(String),
    })
  })

  it('透传未标注响应契约的接口', async () => {
    const response = await request(app.getHttpServer())
      .get('/unvalidated')
      .expect(200)

    expect(response.body).toEqual({ value: 42 })
  })
})
