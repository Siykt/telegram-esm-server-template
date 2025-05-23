import path, { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import cors from '@koa/cors'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mount from 'koa-mount'
import koaStatic from 'koa-static'
import logger from './common/logger.js'
import { ENV } from './constants/env.js'
import { routerSetup } from './core/lib/defineRouter.js'
import { setupTelegramClient } from './core/telegram/setup.js'
import { router } from './services/router.js'
import 'reflect-metadata'
import './commands/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

globalThis.__dirname = __dirname
globalThis.__filename = __filename

async function bootstrap() {
  const app = new Koa({ proxy: true })
  app.on('error', (err) => {
    logger.error(err)
  })

  app.use(cors())

  routerSetup()

  logger.info('Starting server...')

  app.use(mount('/files', koaStatic(path.resolve(__dirname, '../public'))))
  app.use(bodyParser())

  app.use(router.routes())

  await setupTelegramClient(app)

  app.listen({ port: ENV.APP_PORT }, () => {
    logger.info(`Server ready at ${ENV.APP_HOST}:${ENV.APP_PORT}`)
  })

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection at:', reason)
  })
}

bootstrap()
