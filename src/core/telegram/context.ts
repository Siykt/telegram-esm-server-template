import { User } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../common/prisma.js';
import LRUCache from '../cache/LRU.js';

type TGChatId = TelegramBot.Chat['id'];

export class TelegramUsersContext {
  private _cache: LRUCache<TGChatId, User | null>;

  // 保存Telegram聊天ID与用户的映射关系
  constructor(capacity = 500) {
    this._cache = new LRUCache(capacity);
  }

  put(chatId: TGChatId, user: User | null) {
    this._cache.put(chatId, user);
  }

  get(chatId: TGChatId) {
    return this._cache.get(chatId);
  }

  del(chatId: TGChatId) {
    this._cache.del(chatId);
  }

  async getAsync(chatId: TGChatId) {
    const cachedUser = this.get(chatId);

    if (!cachedUser) {
      const user = await prisma.user.findUnique({
        where: {
          chatId: chatId.toString(),
          deletedAt: null,
        },
      });
      this.put(chatId, user);
      return user;
    }

    return cachedUser;
  }
}
