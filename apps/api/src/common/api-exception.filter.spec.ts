import {
  type ArgumentsHost,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common'
import { apiErrorSchema } from '@tech-scout/contracts'
import { ApiExceptionFilter } from './api-exception.filter.js'

function respond(exception: unknown) {
  const response = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ header: () => 'trace-1' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost
  new ApiExceptionFilter().catch(exception, host)
  return {
    status: response.status.mock.calls[0][0],
    body: apiErrorSchema.parse(response.json.mock.calls[0][0]),
  }
}

it('同为 401，仅会话失效要求前端重新登录', () => {
  const expired = respond(
    new UnauthorizedException({
      code: 'SESSION_INVALID',
      message: '会话已失效，请重新登录',
    })
  )
  expect(expired.status).toBe(401)
  expect(expired.body).toMatchObject({
    status: 401,
    code: 'SESSION_INVALID',
    message: '会话已失效，请重新登录',
    action: 'reauthenticate',
    retryable: false,
    requestId: 'trace-1',
  })
  const wrongPassword = respond(
    new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: '账号或密码错误',
    })
  )
  expect(wrongPassword.body.action).toBe('none')
})

it('业务冲突保留后端消息，未知异常不暴露内部信息', () => {
  expect(respond(new ConflictException('已选计划已有更新')).body).toMatchObject(
    {
      code: 'HTTP_409',
      status: 409,
      message: '已选计划已有更新',
      action: 'none',
    }
  )
  expect(respond(new Error('private database connection')).body).toMatchObject({
    code: 'HTTP_500',
    status: 500,
    message: '服务器内部错误',
    retryable: true,
    action: 'none',
  })
})
