import { Redis } from 'ioredis';
import _ from 'lodash';
import { ENV } from '../constants/env.js';

const redis = new Redis(+(ENV.REDIS_PORT ?? '6379'), ENV.REDIS_HOST, { password: ENV.REDIS_PASSWORD });
const redisPublisher = new Redis(+(ENV.REDIS_PORT ?? '6379'), ENV.REDIS_HOST, { password: ENV.REDIS_PASSWORD });
const redisSubscriber = new Redis(+(ENV.REDIS_PORT ?? '6379'), ENV.REDIS_HOST, { password: ENV.REDIS_PASSWORD });

export { redis, redisPublisher, redisSubscriber };

const PREFIX = _.snakeCase(ENV.APP_NAME);
function autoAddPrefixKey<F extends (...args: ExpectedAnyData[]) => ExpectedAnyData>(func: F) {
  return (...args: Parameters<F>) => `${PREFIX}:${func(...args)}`;
}

export const RedisKeys = {
  // Telegram
  tg: {
    argsFile: autoAddPrefixKey((msgId: string) => `msg:${msgId}:file`),
    cbParams: autoAddPrefixKey((command: string, key: string) => `cb:${command}:params:${key}`),
    commandLock: autoAddPrefixKey((command: string, chatId: number) => `command:${command}:lock:${chatId}`),
  },
};
