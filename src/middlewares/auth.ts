import type { User } from '@prisma/client'
import type { Context, Next } from 'koa'
import jsonwebtoken from 'jsonwebtoken'
import { prisma } from '../common/prisma.js'
import { ENV } from '../constants/env.js'

export function authPassword(psd: string) {
  return async (ctx: Context, next: Next) => {
    if (ctx.header.authorization !== psd) {
      ctx.status = 401
      ctx.body = { code: 401, message: 'Unauthorized' }
    }
    else {
      await next()
    }
  }
}

export function authJwt() {
  return async (ctx: Context, next: Next) => {
    try {
      if (!ctx.header.authorization)
        throw new Error('No authorization header')
      const jwtUser: User = jsonwebtoken.verify(ctx.header.authorization, ENV.SERVER_AUTH_PASSWORD) as User
      const user = await prisma.user.findUnique({ where: { id: jwtUser.id } })
      if (!user)
        throw new Error('Unauthorized')

      ctx.state.user = user
    }
    catch {
      ctx.status = 401
      ctx.body = { code: 401, message: 'Unauthorized' }
      return
    }

    await next()
  }
}
