import './basic.js';
import { defineTGCommand } from '../core/telegram/defineCommand.js';

// Define help command
defineTGCommand({
  command: 'help',
  description: 'show help message',
});
