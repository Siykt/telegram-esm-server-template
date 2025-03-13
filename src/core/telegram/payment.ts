import type { TelegramBotClient } from './client.js'
import EventEmitter from 'node:events'
import { nanoid } from 'nanoid'
import LRUCache from '../cache/LRU.js'

export interface CreateStarInvoiceLinkParameters {
  /**
   * chatId
   */
  chatId: number

  /**
   * USD Price
   * @description $1.99 = 100⭐️
   */
  price?: number

  /**
   * Stars
   * @description 1⭐️ = 0.02$
   */
  stars?: number

  /**
   * Product name, 1-32 characters
   */
  title: string

  /**
   * Product description, 1-255 characters
   */
  description: string
}

export class TelegramPayment {
  private eventEmitter = new EventEmitter()

  constructor(private client: TelegramBotClient) {
    this.initStarPayment()
  }

  private _resolveStarPaymentCache = new LRUCache<string, number>(1000)

  private initStarPayment() {
    this.client.bot.on('pre_checkout_query', async (query) => {
      const payload = query.invoice_payload
      const chatId = this._resolveStarPaymentCache.get(payload)
      if (!chatId)
        return

      this._resolveStarPaymentCache.delete(payload)
      this.client.bot.answerPreCheckoutQuery(query.id, true)
      this.eventEmitter.emit(payload, chatId)
    })
  }

  async createStarInvoiceLink(parameters: CreateStarInvoiceLinkParameters) {
    const payload = nanoid(10)
    this._resolveStarPaymentCache.set(payload, parameters.chatId)
    if (!parameters.price && !parameters.stars)
      throw new Error('Price or Stars is required')

    const link = await this.client.bot.createInvoiceLink(parameters.title, parameters.description, payload, '', 'XTR', [
      { label: 'Buy', amount: Math.ceil(
        parameters.price ? parameters.price * 100 : parameters.stars as number,
      ) },
    ])

    return { link, payload }
  }

  async sendStarInvoiceMessage(parameters: CreateStarInvoiceLinkParameters) {
    const payload = nanoid(10)
    this._resolveStarPaymentCache.set(payload, parameters.chatId)

    const message = await this.client.bot.sendInvoice(
      parameters.chatId,
      parameters.title,
      parameters.description.replace('{{payload}}', payload),
      payload,
      '',
      'XTR',
      [
        { label: 'Buy', amount: Math.ceil(
          parameters.price ? parameters.price * 100 : parameters.stars as number,
        ) },
      ],
    )

    return { message, payload }
  }

  onStarPayment(payload: string, callback: (chatId: number) => void) {
    this.eventEmitter.on(payload, callback)
    return () => {
      this.eventEmitter.off(payload, callback)
    }
  }
}
