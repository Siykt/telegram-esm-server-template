import { User } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../common/logger.js';
import { redis, RedisKeys } from '../../common/redis.js';
import { botClient, TelegramBotClient } from './client.js';

type TGCommandArgTypes = 'string' | 'boolean' | 'number' | 'file';

export type TGCommandArgs = Recordable<{
  type?: TGCommandArgTypes;
  required?: boolean;
  description?: string;
  templateFilepath?: string;
  contentType?: string;
}>;

type TGCommandArgTypeMapper<T> = T extends 'string'
  ? string
  : T extends 'boolean'
  ? boolean
  : T extends 'number'
  ? number
  : T extends 'file'
  ? `https://{string}`
  : never;

type ArgsFromConfig<T extends TGCommandArgs> = {
  [K in keyof T]: TGCommandArgTypeMapper<T[K]['type']>;
};

export type TGCommandContext<T extends TGCommandArgs> = {
  command: string;
  client: TelegramBotClient;
  msg: TelegramBot.Message;
  chatId: TelegramBot.Message['chat']['id'];
  match?: RegExpMatchArray | null;
  data?: Recordable<string | number | boolean>;
  args: ArgsFromConfig<T>;

  // Add more context here
  user?: User;
};

export type TGCommandMiddleware = (
  ctx: TGCommandContext<TGCommandArgs>,
  abort: (msg?: string) => void
) => Promise<unknown> | unknown;

type TGCommand<T extends TGCommandArgs> = {
  command: string;
  description: string;
  templatePath?: string;
  setup?: (ctx: Omit<TGCommandContext<T>, 'msg' | 'match' | 'args' | 'chatId'>) => unknown;
  callback?: (ctx: TGCommandContext<T>) => unknown;
  data?: Record<string, string | number>;
  args?: T;
  cleanup?: (ctx: TGCommandContext<T>) => unknown;
  middlewares?: TGCommandMiddleware[];
};

const commands = new Map<string, TGCommand<ExpectedAnyData>>();

export async function setupTGCommands(): Promise<boolean> {
  if ((await fs.access(path.resolve('temp')).catch(() => false)) === false) {
    await fs.mkdir(path.resolve('temp'));
  }

  try {
    const newCommands: TelegramBot.BotCommand[] = [];

    for (const [command, config] of commands) {
      try {
        await config.setup?.({ command, client: botClient, data: config.data });
      } catch (error) {
        logger.error(`Error setting up command ${command}: ${(error as Error)?.message}`);
      }

      newCommands.push({ command, description: config.description });
    }

    await botClient.bot.setMyCommands(newCommands);
    return true;
  } catch (error) {
    console.error('Error setting up Telegram commands:', error);
    return setupTGCommands();
  }
}

// Get the value of the argument based on the type
function getArgsValue(type: TGCommandArgTypes, value: string) {
  return type === 'boolean' ? value === 'true' : type === 'number' ? parseInt(value) : value;
}

// generate arguments tip message
function generateArgsTipMessage(arg: TGCommandArgs[string]) {
  let msg = '';

  if (arg.type === 'boolean') {
    msg = `${arg.description}请选择是\\(/yes\\) 或 否\\(/no\\)`;
  } else if (arg.type === 'file') {
    msg = `${arg.description ?? '请下载文件并按照按照文件中的格式填写后重新发送'}, 请勿超过 50 Mb`;
  } else {
    msg = `请输入${arg.description || ''}`;
  }

  if (!arg.required) {
    msg += '或跳过\\(/skip\\)';
  }

  return msg;
}

// Send a template file to the chat
async function sendTemplate(
  client: TelegramBotClient,
  msg: TelegramBot.Message,
  arg: DeepNonNullable<TGCommandArgs>[string]
) {
  try {
    await client.bot.sendDocument(
      msg.chat.id,
      await fs.readFile(arg.templateFilepath),
      { caption: generateArgsTipMessage(arg) },
      {
        filename: path.basename(arg.templateFilepath as string),
        contentType: arg.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }
    );
  } catch (error) {
    logger.error(`Error sending template for ${arg.description}: ${(error as Error)?.message || 'parse error'}`);
  }
}

// Get the arguments for the command
async function getCommandArgs<T extends TGCommandArgs, R extends ArgsFromConfig<T>, K extends keyof R, V extends R[K]>(
  client: TelegramBotClient,
  msgId: string,
  msg: TelegramBot.Message,
  args?: T
) {
  const result = {} as R;
  if (!args) return result;

  for (const [key, { type = 'string', required, description, ...fileInfo }] of Object.entries(args)) {
    await new Promise<void>((resolve, reject) => {
      const callback = async (newMsg: TelegramBot.Message) => {
        // pass only the same chat
        if (newMsg.chat.id !== msg.chat.id) return;

        const done = (err?: Error) => {
          if (err) {
            logger.error(err);
            reject(err);
          } else {
            resolve();
          }
          client.bot.off('message', callback);
        };

        // skip
        if (newMsg.text === '/skip' && !required) return done();

        // check if the message is a command
        if (/^\/(yes|no)/.test(newMsg.text ?? '')) {
          if (type !== 'boolean') return done(new Error('Boolean type required'));

          result[key as K] = (newMsg.text === '/yes') as V;
          return done();
        }

        // stop on new command
        if (newMsg.text?.startsWith('/')) return done(new Error('New command detected'));

        if (type === 'file') {
          if (!newMsg.document) return done(new Error('File is required'));

          try {
            const filepath = path.resolve(`temp/${newMsg.document.file_unique_id}-${newMsg.document.file_name}`);
            result[key as K] = (await client.downloadFileMessage(newMsg, filepath)) as V;
            await redis.set(RedisKeys.tg.argsFile(msgId), filepath);
          } catch (error) {
            return done(error as Error);
          }

          return done();
        }

        if (!newMsg.text) return done(new Error('Text is required'));

        result[key as K] = getArgsValue(type, newMsg.text) as V;
        done();
      };

      client.bot.on('message', callback);

      if (type === 'file') {
        if (!fileInfo.templateFilepath) return reject(new Error('Filepath is required for file type'));

        sendTemplate(client, msg, {
          type,
          required,
          description,
          ...fileInfo,
        } as DeepNonNullable<TGCommandArgs>[string]);

        return;
      }

      client.sendMDMessage(msg.chat.id, generateArgsTipMessage({ type, required, description }));
    });
  }

  return result;
}

async function unlinkArgsFile(msgId: string) {
  const filepath = await redis.get(RedisKeys.tg.argsFile(msgId));
  if (filepath) {
    await fs.unlink(filepath);
  }
}

function match2Args(commandArgs?: TGCommandArgs, match?: RegExpMatchArray | null) {
  const args: ArgsFromConfig<TGCommandArgs> = {};
  const value = match?.[1];

  if (!commandArgs || !value) return args;

  const params = new URLSearchParams(value);

  for (const [key] of Object.entries(commandArgs)) {
    const value = params.get(key) as ArgsFromConfig<TGCommandArgs>[keyof typeof commandArgs];
    if (value === null) continue;
    args[key as keyof typeof commandArgs] = getArgsValue(commandArgs[key]?.type ?? 'string', value.toString());
  }

  return args;
}

function filterCommandArgs<T extends TGCommandArgs>(args?: T, matchedArgs?: ArgsFromConfig<T>) {
  const newCommandsArgs = {} as T;

  if (!args || !matchedArgs) return newCommandsArgs;

  for (const key in args) {
    if (matchedArgs[key] === undefined) {
      newCommandsArgs[key] = args[key];
    }
  }
  return newCommandsArgs;
}

export async function dispatchCommand(command: string, msg: TelegramBot.Message, match?: RegExpMatchArray | null) {
  if (!commands.has(command)) return;

  const msgId = msg.message_id.toString();

  const {
    args: commandArgs,
    templatePath,
    data,
    cleanup,
    middlewares,
    callback = ({ command, client, msg, data }) => {
      client.sendTemplateDocument(msg.chat.id, templatePath || command, data);
    },
  } = commands.get(command) as TGCommand<TGCommandArgs>;

  try {
    const ctx: TGCommandContext<TGCommandArgs> = {
      command,
      client: botClient,
      msg,
      match,
      data,
      chatId: msg.chat.id,
      args: match2Args(commandArgs, match),
    };

    let aborted = false;
    let abortMsg: string | undefined = undefined;
    if (middlewares) {
      for (const middleware of middlewares) {
        await middleware(ctx, (msg) => {
          aborted = true;
          abortMsg = msg;
        });

        if (aborted) {
          if (abortMsg) await botClient.sendMDMessage(msg.chat.id, abortMsg);
          throw new Error('Middleware aborted');
        }
      }
    }

    ctx.args = {
      ...ctx.args,
      ...(await getCommandArgs(botClient, msgId, msg, filterCommandArgs(commandArgs, ctx.args))),
    };

    await callback(ctx);
    await cleanup?.(ctx);
  } catch (error) {
    logger.error(`Error executing command ${command}: ${(error as Error)?.message}`);
  } finally {
    await unlinkArgsFile(msgId);
  }
}

export function defineTGCommand<T extends TGCommandArgs>({ command, ...other }: TGCommand<T>) {
  if (commands.has(command)) {
    logger.warn(`Command ${command} already exists, overwriting`);
    botClient.bot.removeTextListener(new RegExp(`^/${command}(\\?.*)?$`));
  }

  commands.set(command, { command, ...other });
  botClient.bot.onText(new RegExp(`^/${command}(\\?.*)?$`), async (msg, match) => {
    const key = RedisKeys.tg.commandLock(command, msg.chat.id);
    // distributed lock
    if (await redis.get(key)) return;
    await redis.set(key, '1', 'EX', 2);
    await dispatchCommand(command, msg, match);
  });

  return setupTGCommands;
}
