import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { configureApp } from './app.setup.js'

if (existsSync(new URL('../.env', import.meta.url))) {
  loadEnvFile(new URL('../.env', import.meta.url))
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  configureApp(app)
  await app.listen(process.env.PORT ?? 3000)
}
await bootstrap()
