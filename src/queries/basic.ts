import { defineTGQueryCallback } from '../core/telegram/defineCallback.js'

export const close = defineTGQueryCallback({
  query: 'close',
  text: '❌ close',
  callback: async ({ client, msg }) => {
    if (!msg)
      return

    await client.bot.editMessageText('this message is closed!', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[del]],
      },
    })
  },
})

export const del = defineTGQueryCallback({
  query: 'delete',
  text: '🗑 delete',
  callback: async ({ client, msg }) => {
    if (!msg)
      return

    await client.bot.deleteMessage(msg.chat.id, msg.message_id)
  },
})
