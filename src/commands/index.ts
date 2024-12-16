import { defineTGCommand } from '../core/telegram/defineCommand.js'
import './basic.js'

// Define help command
defineTGCommand({
  command: 'help',
  description: 'show help message',
})
