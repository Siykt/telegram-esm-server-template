import type { Middleware } from 'koa'
import logger from '../common/logger.js'

export const restful: Middleware = async (ctx, next) => {
  try {
    await next()
    if (!ctx.body) {
      ctx.status = 404
      ctx.body = { code: 404, message: 'Not Found' }
      return
    }
    if (ctx.body.code === undefined)
      ctx.body = { code: 0, data: ctx.body, message: ctx.body.message ?? 'Success' }
  }
  catch (error: unknown) {
    console.error(error)
    logger.error(`Internal Server Error: ${error}`)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Internal Server Error' }
  }
}
