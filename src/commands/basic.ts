import { defineTGCommand } from '../core/telegram/defineCommand.js';
import { Queries } from '../queries/index.js';

defineTGCommand({
  command: 'start',
  description: 'start bot',
  callback: async ({ client, chatId }) => {
    await client.sendMDMessage(
      chatId,
      'Hello, I am a bot to help you manage your assets. Please use /help to get started.',
      {
        reply_markup: {
          inline_keyboard: [[Queries.close], [Queries.del]],
        },
      }
    );
  },
});
