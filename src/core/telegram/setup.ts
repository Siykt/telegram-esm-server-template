import type koa from 'koa'
import type TelegramBot from 'node-telegram-bot-api'
import logger from '../../common/logger.js'
import { ENV } from '../../constants/env.js'
import { defineRouter } from '../lib/defineRouter.js'
import { botClient } from './client.js'
import { setupTGQueries } from './defineCallback.js'
import { setupTGCommands } from './defineCommand.js'

async function setupTGBotWebHook(app: koa) {
  if (!ENV.TELEGRAM_USE_WEBHOOK)
    return

  const router = defineRouter({
    prefix: `/bot`,
    health: true,
  })

  router.post(ENV.TELEGRAM_BOT_TOKEN, async (ctx) => {
    botClient.bot.processUpdate(ctx.request.body as TelegramBot.Update)
    ctx.status = 200
    ctx.body = 'ok'
  })

  app.use(router.routes())

  const webhookURL = `${ENV.APP_HOST}/bot${ENV.TELEGRAM_BOT_TOKEN}`
  const { url } = await botClient.bot.getWebHookInfo()
  if (url !== webhookURL) {
    logger.info('Update WebHook')
    const state = await botClient.bot.setWebHook(webhookURL)
    logger.info(`Set WebHook State: ${state}`)
  }
}

function setupTGMessenger() {
  // debug log all messages
  botClient.bot.on('message', (msg) => {
    if (msg.text) {
      logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: ${msg.text}`)
    }

    if (msg.document) {
      logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: [Document]`)

      // get document
      const document = msg.document
      if (document) {
        botClient.bot.getFileLink(document.file_id).then((link) => {
          logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: ${link}`)
        })
      }
    }

    if (msg.photo) {
      logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: [Photo]`)

      // get photo
      const photo = msg.photo.at(-1)
      if (photo) {
        botClient.bot.getFileLink(photo.file_id).then((link) => {
          logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: ${link}`)
        })
      }
    }

    if (msg.contact) {
      logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: [Contact]`)
    }
  })

  botClient.bot.on('callback_query', (query) => {
    logger.debug(`[TGCallbackQuery] @${query.from.username}_${query.from.id}: ${query.data}`)
  })
}

export async function setupTelegramClient(app: koa) {
  setupTGMessenger()
  setupTGQueries()
  setupTGCommands()
  setupTGBotWebHook(app)
  logger.info('Telegram bot client setup completed')
}
