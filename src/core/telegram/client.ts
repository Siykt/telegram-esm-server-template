import _ from 'lodash';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDev } from '../../common/is.js';
import logger from '../../common/logger.js';
import { ENV } from '../../constants/env.js';
import { RateLimiterControl } from '../lib/rateLimiterControl.js';
import { TelegramUsersContext } from './context.js';
import { formatMarkdownMessages } from './utils.js';

interface TelegramBotError {
  code: 'ETELEGRAM';
  message: string;
}

const template = isDev() ? _.template : _.memoize(_.template);

export class TelegramBotClient extends RateLimiterControl {
  override failedRetryLimit = 10;

  bot: TelegramBot;

  ctx = {
    users: new TelegramUsersContext(),
  };

  constructor(token: string, options?: TelegramBot.ConstructorOptions) {
    super();
    this.rateLimiter.updateSettings({
      id: 'TelegramTGClient',
      minTime: 500,
      maxConcurrent: 2,
    });
    this.bot = this.createRateLimiterProxy(new TelegramBot(token, options));
  }

  override checkJobFailError(error: Error | TelegramBotError, retryCount: number) {
    const isLimit = super.checkJobFailError(error, retryCount);
    if (isLimit) return true;
    if ((error as TelegramBotError).code === 'ETELEGRAM') {
      return !error.message.includes('400') && !error.message.includes('429');
    }
    return false;
  }

  sendMDMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions & { autoformat?: boolean }
  ) {
    return this.bot.sendMessage(chatId, options?.autoformat !== false ? formatMarkdownMessages(text) : text, {
      parse_mode: 'MarkdownV2',
      ...options,
    });
  }

  async sendTemplateDocument(
    chatId: number | string,
    templateName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any,
    options?: TelegramBot.SendMessageOptions & { autoformat?: boolean }
  ) {
    try {
      const templatePath = path.resolve(`docs/${templateName}.md`);
      await fs.access(templatePath);
      let doc = await fs.readFile(templatePath, 'utf-8');

      if (data) {
        doc = template(doc)(data);
      }

      const resMsg = await this.sendMDMessage(chatId, doc, options);
      return resMsg;
    } catch (error) {
      logger.error(`Error sending template for ${templateName}: ${(error as Error)?.message || 'parse error'}`);
      return null;
    }
  }

  async editMessageUseMarkdown(
    chatId: number | string,
    message_id: number,
    text: string,
    options?: TelegramBot.EditMessageTextOptions & { autoformat?: boolean }
  ) {
    return this.bot.editMessageText(options?.autoformat !== false ? formatMarkdownMessages(text) : text, {
      chat_id: chatId,
      message_id: message_id,
      parse_mode: 'MarkdownV2',
      ...options,
    });
  }

  async editMessageTextUseTemplate(
    chatId: number | string,
    message_id: number,
    templateName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any,
    options?: TelegramBot.EditMessageTextOptions & { autoformat?: boolean }
  ) {
    try {
      await fs.access(path.resolve(`docs/${templateName}.md`));
      let doc = await fs.readFile(path.resolve(`docs/${templateName}.md`), 'utf-8');

      if (data) {
        doc = template(doc)(data);
      }

      const resMsg = await this.bot.editMessageText(options?.autoformat === false ? doc : formatMarkdownMessages(doc), {
        chat_id: chatId,
        message_id: message_id,
        parse_mode: 'MarkdownV2',
        ...options,
      });
      if (!resMsg) return null;
      return resMsg as TelegramBot.Message;
    } catch (error) {
      logger.error(`Error sending template for ${templateName}: ${(error as Error)?.message || 'parse error'}`);
      return null;
    }
  }

  async downloadFileMessage(msg: TelegramBot.Message, filepath: string) {
    if (!msg.document) throw new Error('Message is not a document');

    await fs.writeFile(filepath, await this.bot.getFileStream(msg.document.file_id));
    return filepath;
  }
}

export const botClient = new TelegramBotClient(ENV.TELEGRAM_BOT_TOKEN, {
  webHook: ENV.TELEGRAM_USE_WEBHOOK,
  polling: ENV.TELEGRAM_USE_WEBHOOK ? false : { interval: ENV.TELEGRAM_POLLING_INTERVAL },
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4,
    },
  } as unknown as TelegramBot.ConstructorOptions['request'],
});
