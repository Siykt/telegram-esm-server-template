import { nanoid } from 'nanoid';
import TelegramBot from 'node-telegram-bot-api';
import logger from '../../common/logger.js';
import { redis, RedisKeys } from '../../common/redis.js';
import { botClient, TelegramBotClient } from './client.js';
import { safeStringify } from './utils.js';

type TGQueryArgs = Recordable<{
  type?: 'string' | 'boolean' | 'number';
  required?: boolean;
}>;

type ArgsFromConfig<T extends TGQueryArgs> = {
  [K in keyof T]: T[K]['type'] extends 'string'
    ? string
    : T[K]['type'] extends 'boolean'
    ? boolean
    : T[K]['type'] extends 'number'
    ? number
    : never;
};

type IsRequired<T extends TGQueryArgs> = {
  [K in keyof T]: T[K]['required'] extends true ? K : never;
}[keyof T];

type TGQueryCallbackContext<T extends TGQueryArgs> = {
  query: string;
  client: TelegramBotClient;
  msg?: TelegramBot.Message;
  args: ArgsFromConfig<T>;
};

type TGQueryCallbackConfig<T extends TGQueryArgs> = {
  query: string;
  text: string;
  callback?: (ctx: TGQueryCallbackContext<T>) => unknown;
  args?: T;
  cleanup?: (ctx: TGQueryCallbackContext<T>) => unknown;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryCallbacks = new Map<string, TGQueryCallbackConfig<any>>();

export function setupTGQueries() {
  botClient.bot.on('callback_query', async (query) => {
    const throwError = (message: string) => {
      logger.error(`[TGCallbackQuery] @${query.from.username}_${query.from.id}: ${message}`);
      botClient.bot.answerCallbackQuery(query.id, { text: message, show_alert: true });
    };

    if (!query.data) return throwError('No data');

    const [command, argsKey] = query.data.split(':');
    if (!command) return throwError('No query');

    const callback = queryCallbacks.get(command);
    if (!callback) return throwError('Query not found');

    const parserArgs = {} as ArgsFromConfig<typeof callback.args>;

    if (argsKey) {
      const cacheParams = await redis.get(RedisKeys.tg.cbParams(command, argsKey));

      if (cacheParams) Object.assign(parserArgs, JSON.parse(cacheParams));
    }

    logger.debug(`[TGCallbackQuery] @${query.from.username}_${query.from.id}: ${command} ${safeStringify(parserArgs)}`);

    // check required args
    for (const key in callback.args) {
      if (callback.args[key]?.required && parserArgs[key] === undefined) {
        return throwError(`Missing required argument: ${key}`);
      }
    }

    const ctx = { query: command, client: botClient, msg: query.message, args: parserArgs };
    try {
      botClient.bot.answerCallbackQuery(query.id);
      await callback.callback?.(ctx);
      await callback.cleanup?.(ctx);
    } catch (error) {
      logger.error(`Error executing query callback ${command}: ${(error as Error)?.message}`);
    }
  });
}

export function defineTGQueryCallback<T extends TGQueryArgs>(
  config: TGQueryCallbackConfig<T> & { args: TGQueryArgs }
): (args: Partial<ArgsFromConfig<T>> & Pick<ArgsFromConfig<T>, IsRequired<T>>) => TelegramBot.InlineKeyboardButton;

export function defineTGQueryCallback<T extends TGQueryArgs>(
  config: TGQueryCallbackConfig<T> & { args?: TGQueryArgs }
): TelegramBot.InlineKeyboardButton;

export function defineTGQueryCallback<
  T extends TGQueryArgs,
  C extends TGQueryCallbackConfig<T>,
  R = C extends { args: TGQueryArgs }
    ? (args: ArgsFromConfig<T>) => TelegramBot.InlineKeyboardButton
    : TelegramBot.InlineKeyboardButton
>(config: TGQueryCallbackConfig<T>): R {
  queryCallbacks.set(config.query, config);

  if (config.args) {
    if (config.query.length > 64 - 9) throw new Error('Query length must be less than 55 characters(9 for key)');
    return ((args: Partial<ArgsFromConfig<T>> & Pick<ArgsFromConfig<T>, IsRequired<T>>) => {
      const key = nanoid(8);
      const params: Partial<ArgsFromConfig<T>> = {};

      for (const key in config.args) {
        const value = args?.[key];
        if (config.args[key]?.required && value === undefined) {
          throw new Error(`Missing required argument: ${key}`);
        }
        params[key] = value;
      }

      redis.set(RedisKeys.tg.cbParams(config.query, key), safeStringify(params));

      return {
        text: config.text.replace(/\{(\w+)\}/g, (_, key) => {
          return params[key as keyof typeof params] as string;
        }),
        callback_data: `${config.query}:${key}`,
      };
    }) as R;
  }

  return {
    text: config.text,
    callback_data: config.query,
  } as R;
}
