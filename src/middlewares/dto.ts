import { Context, Next } from 'koa';
import { ZodObject, ZodRawShape, ZodError } from 'zod';
import logger from '../common/logger.js';
import _ from 'lodash';

export const dto =
  <T extends ZodRawShape, S extends ZodObject<T>>(schema: S) =>
  async (ctx: Context, next: Next) => {
    try {
      schema.parse(ctx.request.body);
    } catch (error: unknown) {
      const errors = _.map((error as ZodError).errors, 'message');
      logger.error(`Validation Error: ${errors}`);

      ctx.status = 412;
      ctx.body = { code: 412, message: 'DTO check error.', error };
      return;
    }

    await next();
  };
