import { Context, Next } from 'koa';
import { ENV } from '../constants/env.js';
import { User } from '@prisma/client';
import jsonwebtoken from 'jsonwebtoken';
import { prisma } from '../common/prisma.js';

export const authPassword = (psd: string) => async (ctx: Context, next: Next) => {
  if (ctx.header.authorization !== psd) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Unauthorized' };
    return;
  } else {
    await next();
  }
};

export const authJwt = () => async (ctx: Context, next: Next) => {
  try {
    if (!ctx.header.authorization) throw new Error('No authorization header');
    const jwtUser: User = jsonwebtoken.verify(ctx.header.authorization, ENV.SERVER_AUTH_PASSWORD) as User;
    const user = await prisma.user.findUnique({ where: { id: jwtUser.id } });
    if (!user) throw new Error('Unauthorized');

    ctx.state.user = user;
  } catch (error) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Unauthorized' };
    return;
  }

  await next();
};
