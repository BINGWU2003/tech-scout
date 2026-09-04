import { Test, TestingModule } from '@nestjs/testing'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'

describe('AppController 应用控制器', () => {
  let appController: AppController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile()

    appController = app.get<AppController>(AppController)
  })

  describe('根路径', () => {
    it('返回 "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!')
    })
  })
})
