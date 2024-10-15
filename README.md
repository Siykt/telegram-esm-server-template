# A telegram nodejs server template with ESM support

This project serves as an open-source template for building server-side applications, with a focus on integrating Telegram bot functionalities using `Koa`, `TypeScript`, and the `node-telegram-bot-api` library. It incorporates a robust setup, including the custom `defineTGCommand` and `defineTGQueryCallback` methods to manage Telegram commands and inline button interactions efficiently. The project leverages `tsup` for building, with integrated ESLint + Prettier for maintaining clean, well-formatted code. It provides a scalable and maintainable foundation for developers looking to create web services or APIs with seamless Telegram bot integration.

## Introduce

### Gateway Layer

This is the data exchange and network communication layer implemented using Node.js Koa WebServer.

#### Cloudflare Global CDN Service

Cloudflare provides free global CDN service. We just need to bind the domain to the server port.

Without a domain, it is impossible to use the Telegram webhook, and the Telegram Bot Client will fallback to polling mode.

#### Koa WebServer

This is the base web service implemented using Node.js. Through Koa, we can implement REST APIs and external nodes for the Telegram WebHook.

Here are some implementation details for future reference.

##### 0x1 **Koa’s Router Define Pattern**

When we need modularized routes, we require a convenient design pattern to break free from logic that is purely convention-based.

Here, we use a factory-like pattern to provide a simple and intuitive modular division, known as the **Route Define**.

This pattern defines parameters and decouples Koa Router callback functions (Middleware Callback) to achieve modularization.
Here’s the continuation of the translation:

```typescript
// Router Define parameters
export interface RouterOptions {
  prefix?: string;
  options?: Router.IRouterOptions;
  middlewares?: Middleware[];
  setup?: () => Promise<void>;
  routes?: Router[];
  health?: boolean;
}
```

- The `prefix` parameter is the same as the configuration in `Router.IRouterOptions`, which is also a definition parameter for Koa `Router`.
- The `middlewares` field provides the same middleware to all sub-routes.
- The `setup` field is used to support the initialization of the router.
- The `routes` field defines the sub-routes under this router. For example, the `user` route can share the `:id` query sub-route.
- The `health` field provides a simple health check service sub-route.

Next, we need to register a `setup` method that will be executed during the application bootstrap stage:

```typescript
// Collect the setup configuration of Router Define and execute during the application’s bootstrap phase
let setups: Required<RouterOptions>['setup'][] = [];

// Register the Router Define’s setup value during bootstrap
export const routerSetup = async () => {
  for (const setup of setups) {
    await setup(); // Execute independently to avoid complex scheduling
  }

  // Clear setups
  setups = [];
};
```

Note that routes may have hierarchical relationships. To avoid overly complex scheduling, the execution process here is simplified, and this should be considered when using it.

Now, let’s implement the `defineRouter` method. It’s quite straightforward:

```typescript
export function defineRouter(options: RouterOptions) {
  const router = new Router({ prefix: options.prefix, ...options.options });

  // Add health check service
  if (options.health) {
    router.get('/health', (ctx) => (ctx.body = 'OK'));
  }

  // Register middlewares
  if (options.middlewares) {
    router.use(...options.middlewares);
  }

  // Register sub-routes
  options.routes?.forEach((route) => {
    router.use(route.routes());
  });

  // Register setup
  if (options.setup) {
    setups.push(options.setup);
  }

  return router;
}
```

What’s clever here is that the middlewares in the `middlewares` field are registered before the routes and in the order they are added. This way, the execution order of middlewares is maintained, following Koa's onion model.

To use it, simply import the `defineRouter` method:

```typescript
export const userRouter = defineRouter({
  prefix: '/user',
  // Simple password-based authentication control
  middlewares: [authPassword(ENV.SERVER_AUTH_PASSWORD)],
});
```

##### 0x2 Common Koa Middlewares

Common middlewares include REST wrapping middlewares, authentication middlewares, form validation middlewares, etc.

###### 0x2.1 **RESTful Middleware**

This middleware wraps the route's return data and defines the relevant return codes.

```typescript
import { Middleware } from 'koa';
import logger from '../common/logger.js';

export const restful: Middleware = async (ctx, next) => {
  try {
    await next();
    if (!ctx.body) {
      ctx.status = 404; // 404 for unknown return values
      ctx.body = { code: 404, message: 'Not Found' };
      return;
    }
    // Skip custom code or wrap the body
    if (ctx.body.code === undefined) ctx.body = { code: 0, data: ctx.body, message: ctx.body.message ?? 'Success' };
  } catch (error: unknown) {
    console.error(error);
    logger.error(`Internal Server Error: ${error}`);
    ctx.status = 500; // Errors thrown by the Router are treated as service errors
    ctx.body = { code: 500, message: 'Internal Server Error' };
  }
};
```

###### **0x2.2 DTO Middleware**

Using `zod` for form validation, we can decouple form validation logic by defining DTO (Data Transfer Object) schemas.

```typescript
import { Context, Next } from 'koa';
import { ZodObject, ZodRawShape, ZodError } from 'zod';
import logger from '../common/logger.js';
import _ from 'lodash';

export const dto =
  <T extends ZodRawShape, S extends ZodObject<T>>(schema: S) =>
  async (ctx: Context, next: Next) => {
    try {
      // Validate schema
      schema.parse(ctx.request.body);
    } catch (error: unknown) {
      // Handle validation failures
      const errors = _.map((error as ZodError).errors, 'message');
      logger.error(`Validation Error: ${errors}`);

      ctx.status = 412;
      ctx.body = { code: 412, message: 'DTO check error.', error };
      return;
    }

    await next();
  };
```

###### **0x2.3 Auth Password Middleware**

A simple authentication middleware using a local password. This authentication method is not suitable for public use, and for more complex mechanisms, `jwt` can be used.

```typescript
import { Context, Next } from 'koa';

export const authPassword = (psd: string) => async (ctx: Context, next: Next) => {
  // Check if the local password matches
  if (ctx.header.authorization !== psd) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Unauthorized' }; // Throw an unauthorized request
    return;
  } else {
    await next();
  }
};
```

###### **0x2.4 Auth JWT Middleware**

Using the `jsonwebtoken` package to provide JWT signature functionality, we can implement a simple JWT validation middleware:

```typescript
import jsonwebtoken from 'jsonwebtoken';
import { User } from '@prisma/client';
import { prisma } from '../common/prisma.js';

export const authJwt = () => async (ctx: Context, next: Next) => {
  try {
    if (!ctx.header.authorization) throw new Error('No authorization header');
    const jwtUser: User = jsonwebtoken.verify(ctx.header.authorization, ENV.SERVER_AUTH_PASSWORD) as User;
    const user = await prisma.user.findUnique({ where: { id: jwtUser.id } });
    if (!user) throw new Error('Unauthorized');

    ctx.state.user = user; // Register the user in subsequent middlewares and routes
  } catch (error) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Unauthorized' };
    return;
  }

  await next();
};
```

### Service Layer

#### RPC/REST API Service

This RPC service is primarily implemented by sharing Prisma’s data operation permissions. We use the [ZenStack](https://zenstack.dev/docs/welcome) OpenAPI plugin to implement the middleware.

Since ZenStack does not directly provide a KOA middleware, we need to patch it ourselves:

```typescript
function ZenStackMiddlewareKoaAdapter(ops: MiddlewareOptions) {
  const handle = ZenStackMiddleware({ ...ops, sendResponse: false });
  return async (ctx: Context, next: Next) => {
    const status = (code: number) => (ctx.status = code);
    const get = (key: string) => ctx.request.query[key];

    await handle(
      Object.assign(ctx.request, { status, get, path: ctx.request.path.replace('/api/rest', '') }) as ExpectedAnyData,
      ctx.response as ExpectedAnyData,
      next
    );

    const locals = (ctx.response as unknown as { locals: { status: number; body: object } }).locals;
    ctx.body = Object.assign(locals.body, { code: locals.status });
  };
}
```

You can invoke this middleware by passing in the configuration:

```typescript
router.all(
  /\/api\/rest\/.*/g,
  ZenStackMiddlewareKoaAdapter({
    getPrisma: () => prisma,
    handler: RestApiHandler({ endpoint: `${ENV.APP_HOST}/api/rest` }),
    logger: {
      error: (...args) => {
        console.error(...args);
        console.trace();
      },
    },
  })
);
```

### Telegram Bot

#### 0x1 Wrapping the TelegramBotClient

In actual usage, frequent calls to the Telegram API often encounter rate-limiting issues. This requires us to add a **rate limiter** to control the frequency of these API calls.

We can implement a rate limiter using [Bottleneck](https://github.com/SGrondin/bottleneck), or alternatively use [p-queue](https://github.com/sindresorhus/p-queue) or other similar packages. The methods are similar:

```typescript
import Bottleneck from 'bottleneck';
import logger from '../../common/logger.js';

// Rate Limiter Controller
export class RateLimiterControl {
  failedRetryTime = 1000; // Retry interval
  failedRetryLimit = 10; // Retry limit

  protected rateLimiter = new Bottleneck({
    // Configure 30 QPS limit
    minTime: Math.ceil(1000 / 30),
    maxConcurrent: 30,
  });

  // Logic to check retry on failure
  protected checkJobFailError(_error: unknown, retryCount: number): boolean {
    return retryCount < this.failedRetryLimit;
  }

  constructor() {
    // Retry requests and error handling
    this.rateLimiter.on('failed', (error, jobInfo) => {
      if (this.checkJobFailError(error, jobInfo.retryCount)) {
        logger.error(error);
        logger.warn(
          `Job ${jobInfo.options.id} failed ${jobInfo.retryCount + 1}. Retrying after ${
            this.failedRetryTime
          }ms retries.`
        );
        return this.failedRetryTime;
      }

      logger.error(error);
      return;
    });
  }
}
```

In the Node.js community, the Telegram API is provided by [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api). It’s unlikely that we would create our own Node.js package for this, so we can use a `Proxy` to intercept its method calls.

```typescript
export class RateLimiterControl {
  // ...
  createRateLimiterProxy<T extends object>(target: T) {
    return new Proxy(target, {
      get: (target, prop, receiver) => {
        const origProperty = target[prop as keyof T];
        // Intercept method calls
        if (typeof origProperty === 'function') {
          // More filters can be added here
          return this.rateLimiter.wrap(origProperty.bind(target));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as T;
  }
}

import TelegramBot from 'node-telegram-bot-api';

// Extend the rate limiter controller
export class TelegramBotClient extends RateLimiterControl {
  bot: TelegramBot;

  constructor(token: string, options?: TelegramBot.ConstructorOptions) {
    super();
    // Update rate limit settings
    this.rateLimiter.updateSettings({
      id: 'TelegramTGClient', // Shared rate limit settings
      minTime: 500,
      maxConcurrent: 2,
    });

    // Intercept original TelegramBot methods
    this.bot = this.createRateLimiterProxy(new TelegramBot(token, options));
  }
}
```

After wrapping the TGClientClass, you can add your custom methods, such as `sendMDMessage`. Here, I’m sharing my method for formatting [Telegram MarkdownV2 Message](https://core.telegram.org/bots/api#sendmessage), allowing you to write local markdown templates for sending messages.

Here’s the implementation:

````typescript
export function formatMarkdownMessages(text: string) {
  const escape = /[_*[\]()~`>#+\-=|{}.!]/;
  const replaceEscape = /[~>+=|.!]/;
  const doubleEscape = /[`_*]/;
  const bracketsEscape = /[{}[]()]/;

  // Split string by newline
  const strArr = text.split('\n');

  // ? Not supporting table(|) and code block(```)
  for (const [rowIndex, rawStr] of strArr.entries()) {
    const stack: string[] = [];
    const indexes: number[] = [];
    // Handle special characters * and continuous #, like **bold**, typically composed of two *
    let rawArr = rawStr.replace(/\*{2}|#{2,}\s/g, (match) => match?.[0] ?? '').split('');
    for (const [i, char] of rawArr.entries()) {
      // Skip characters that don't require escaping
      if (!escape.test(char)) continue;
      // Skip already escaped characters
      if (rawArr[i - 1] === '\\') continue;
      // Handle special character #
      if (char === '#') {
        if (i === 0) {
          rawArr = ['*', formatMarkdownMessages(rawArr.slice(rawArr[i + 1] === ' ' ? 2 : 1).join('')), '*'];
          break;
        }
        rawArr[i] = '\\#';
      }
      // Handle special character -, format subsequent spaces
      if (char === '-') {
        if (rawArr[i + 1] === ' ' && i === 0) {
          rawArr[i] = '';
          rawArr[i + 1] = '';
        } else {
          rawArr[i] = '\\-';
        }
        continue;
      }
      // Handle characters that need direct replacement
      if (replaceEscape.test(char)) {
        rawArr[i] = `\\${char}`;
        continue;
      }
      // Handle characters that need double escaping
      if (doubleEscape.test(char)) {
        if (stack.at(-1) === char) {
          stack.pop();
          indexes.pop();
        } else {
          stack.push(char);
          indexes.push(i);
        }
        continue;
      }
      // Handle parentheses, non-link parentheses need to be escaped
      if (bracketsEscape.test(char)) {
        stack.push(char);
        indexes.push(i);
        continue;
      }
    }
    // Check if parentheses are matched
    let start = 0;
    for (const [i, char] of stack.entries()) {
      if (char === '[') {
        start = i;
      } else if (char === ')' && i - start === 3) {
        for (let j = start; j <= i; j++) {
          indexes[j] = -1;
        }
      }
    }
    // Escape illegal characters
    for (const i of indexes) {
      if (i === -1) continue;
      rawArr[i] = `\\${rawArr[i]}`;
    }
    strArr[rowIndex] = rawArr.join('');
  }
  return strArr.join('\n');
}

// Usage in TelegramBotClient
export class TelegramBotClient extends RateLimiterControl {
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
}
````

#### 0x2 Telegram Command Parsing and the `defineCommand` Feature Encapsulation

The design pattern of a Telegram Bot is similar to the command system in a terminal. When a user sends a message, the corresponding command action is executed.

Generally, when a user sends a command, the execution logic follows an interactive, linear process.

All messages should come from the webhook gateway as part of the architecture design. In `node-telegram-bot-api`, every command is triggered through the `EventEmitter`.

Below are some common callback examples:

```typescript
bot.on('message', (msg) => {
  if (msg.text) {
    // Parsing text messages
    logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: ${msg.text}`);
  }

  if (msg.document) {
    // Parsing document messages, mainly for user-provided files. Telegram provides a file_id for download.
    logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: [Document]`);

    const document = msg.document;
    if (document) {
      // Obtain download link via file_id
      botClient.bot.getFileLink(document.file_id).then((link) => {
        logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: ${link}`);
      });
    }
  }

  if (msg.photo) {
    // Parsing photo messages. Telegram provides a file_id to retrieve the link.
    logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: [Photo]`);

    const photo = msg.photo.at(-1);
    if (photo) {
      // Obtain photo URL via file_id
      botClient.bot.getFileLink(photo.file_id).then((link) => {
        logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: ${link}`);
      });
    }
  }

  if (msg.contact) {
    // Parsing contact messages
    logger.debug(`[TGM] @${msg.chat.username}_${msg.chat.id}: [Contact]`);
  }
});

botClient.bot.on('callback_query', (query) => {
  // Callback for inline button clicks
  logger.debug(`[TGCallbackQuery] @${query.from.username}_${query.from.id}: ${query.data}`);
});
```

Using callbacks to implement business logic may not be abstract enough, and the level of data operation encapsulation may not be high. By dissecting the execution flow diagram, we can see that each command execution may require the user to provide additional data inputs.

I was inspired by [citty](https://github.com/unjs/citty) for CLI command encapsulation logic, and I implemented a similar `defineTGCommand` API. Below is my implementation.

##### 0x2.1 `defineCommand` Type Definitions

In business scenarios, users' input types can vary greatly. We need to support not only simple string types but also `boolean`, `number`, and even `file` types.

In TypeScript, we can leverage its generic capabilities to achieve this and make future business logic development easier:

```typescript
// Define supported argument types
type TGCommandArgTypes = 'string' | 'boolean' | 'number' | 'file';

// Utility type
type Recordable<T = any> = Record<string, T>;

// Define concrete argument types
export type TGCommandArgs = Recordable<{
  type?: TGCommandArgTypes; // The type of the argument
  required?: boolean; // Whether the argument is required
  description?: string; // Description provided to the user for the argument
  templateFilepath?: string; // Template file path
  contentType?: string; // Data type of the template file
}>;
```

By utilizing TypeScript's conditional and mapped types, we can enforce and map generics:

```typescript
type ArgsFromConfig<T extends TGCommandArgs> = {
  [K in keyof T]: T[K]['type'] extends 'string' // If the type is 'string', the data type is a string
    ? string
    : T[K]['type'] extends 'boolean' // If the type is 'boolean', the data type is boolean
    ? boolean
    : T[K]['type'] extends 'number' // If the type is 'number', the data type is a number
    ? number
    : T[K]['type'] extends 'file' // If the type is 'file', the data type is a URL string
    ? `https://${string}`
    : never; // If parsing fails, the type is never
};
```

When executing a command, we pass the defined `Args` and other parameters to the callback function. We can define a detailed `Context` for use:

```typescript
export type TGCommandContext<T extends TGCommandArgs> = {
  command: string; // The current command being executed
  msg: TelegramBot.Message; // The original message from the user
  chatId: TelegramBot.Message['chat']['id']; // The user's chatId
  match?: RegExpMatchArray | null; // Matched items when a user sends a command like /command_name?q=query
  data?: Recordable<string | number | boolean>; // Initialized data
  args: ArgsFromConfig<T>; // Arguments for the command
};
```

Finally, we add this to the callback, completing the TGCommand definition:

```typescript
type TGCommand<T extends TGCommandArgs> = {
  command: string; // The defined command
  description: string; // Description for the command, used with setMyCommands
  // Setup callback
  setup?: (ctx: Omit<TGCommandContext<T>, 'msg' | 'match' | 'args' | 'chatId'>) => unknown;
  callback?: (ctx: TGCommandContext<T>) => unknown; // Execution callback
  data?: Record<string, string | number>; // Initialized data
  args?: T; // Arguments for the command
};

export function defineTGCommand<T extends TGCommandArgs>(params: TGCommand<T>) {
  // Internal logic...
}
```

##### 0x2.2 Retrieving Command Arguments

Just defining types won't help us fully encapsulate the logic. Let's break it down step by step.

Specifically, we first need to parse the command's arguments and prompt the user to provide the required data, which may involve sending and replying to multiple messages. This can be achieved using a relatively complex Promise-based solution:

```typescript
// Utility function to get the argument value
function getArgsValue(type: TGCommandArgTypes, value: string) {
  return type === 'boolean' ? value === 'true' : type === 'number' ? parseInt(value) : value;
}

// Retrieve command arguments
async function getCommandArgs<T extends TGCommandArgs, R extends ArgsFromConfig<T>, K extends keyof R, V extends R[K]>(
  client: TelegramBotClient,
  msgId: string,
  msg: TelegramBot.Message,
  args?: T
) {
  // Use the result variable to store results
  const result = {} as R;
  // Return result if no arguments are provided
  if (!args) return result;

  for (const [key, { type = 'string', required, description, ...fileInfo }] of Object.entries(args)) {
    // Use a Promise to get a single argument
    await new Promise<void>((resolve, reject) => {
      const callback = async (newMsg: TelegramBot.Message) => {
        // Skip messages from other users
        if (newMsg.chat.id !== msg.chat.id) return;

        // Handle completion
        const done = (err?: Error) => {
          if (err) {
            logger.error(err);
            reject(err);
          } else {
            resolve();
          }
          client.bot.off('message', callback);
        };

        // Skip optional arguments with /skip command
        if (newMsg.text === '/skip' && !required) return done();

        // Boolean argument
        if (/^\/(yes|no)/.test(newMsg.text ?? '')) {
          if (type !== 'boolean') return done(new Error('Boolean type required'));
          result[key as K] = (newMsg.text === '/yes') as V;
          return done();
        }

        // Handle file type data
        if (type === 'file') {
          if (!newMsg.document) return done(new Error('File is required'));
          try {
            // Write the file to a temporary directory
            const filepath = path.resolve(`temp/${newMsg.document.file_unique_id}-${newMsg.document.file_name}`);
            result[key as K] = (await client.downloadFileMessage(newMsg, filepath)) as V;

            await redis.set(RedisKeys.tg.argsFile(msgId), filepath);
          } catch (error) {
            return done(error as Error);
          }
          return done();
        }

        // Handle text arguments
        if (!newMsg.text) return done(new Error('Text is required'));
        result[key as K] = getArgsValue(type, newMsg.text) as V;
        done();
      };

      client.bot.on('message', callback);
    });
  }
  return result;
}
```

Next, we add logic to send a prompt message to the user:

```typescript
function generateArgsTipMessage(arg: TGCommandArgs[string]) {
  let msg = '';
  if (arg.type === 'boolean') {
    // Boolean type
    msg = `${arg.description} Please choose Yes(/yes) or No(/no).`;
  } else if (arg.type === 'file') {
    // File type
    msg = `${arg.description ?? 'Please download the file and fill it out according to the template, then resend it.'}`;
  } else {
    msg = `Please enter ${arg.description || ''}`; // Text type
  }

  if (!arg.required) {
    msg += ' or skip(/skip)'; // Add a skip option for optional arguments
  }

  return msg;
}
```

Integrate this message into the `getCommandArgs` function and add special handling for file types:

```typescript
// getCommandArgs
// ...
for (const [
  /* ... */
] of Object.entries(args)) {
  // ...
  client.bot.on('message', callback);

  // File types require sending a template file
  if (type === 'file') {
    if (!fileInfo.templateFilepath) return reject(new Error('Filepath is required for file type'));
    sendTemplate(client, msg, {
      type,
      required,
      description,
      ...fileInfo,
    });
    return;
  }

  // Send argument prompt message
  client.sendMDMessage(msg.chat.id, generateArgsTipMessage({ type, required, description }));
}
```

Finally, for temporary files, you can delete them using `fs.unlink`:

```typescript
// Delete temporary file
async function unlinkArgsFile(msgId: string) {
  const filepath = await redis.get(RedisKeys.tg.argsFile(msgId));
  if (filepath) {
    await fs.unlink(filepath);
  }
}
```

##### 0x2.3 Command Execution and Initialization

To make it convenient for other scenarios to execute commands programmatically, we can implement a `dispatchCommand` method that abstracts and handles the execution logic:

```typescript
// Command collection
const commands = new Map<string, TGCommand<any>>();

// Execute command
export async function dispatchCommand(command: string, msg: TelegramBot.Message, match?: RegExpMatchArray | null) {
  if (!commands.has(command)) return; // Skip invalid commands, you can add an error message
  const msgId = msg.message_id.toString();
  const { args: commandArgs, data, callback } = commands.get(command) as TGCommand<TGCommandArgs>;

  try {
    const ctx: TGCommandContext<TGCommandArgs> = {
      command,
      client: botClient, // Instance of TelegramBotClient
      msg,
      match,
      data,
      chatId: msg.chat.id,
      args: {},
    };
    // Get command arguments
    ctx.args = await getCommandArgs(botClient, msgId, msg, commandArgs);
    // Execute callback
    await callback(ctx);
  } catch (error) {
    logger.error(`Error executing command ${command}: ${(error as Error)?.message}`);
  } finally {
    await unlinkArgsFile(msgId);
  }
}
```

Add an `onText` listener to capture messages sent by users and execute commands using `dispatchCommand`:

```typescript
export function defineTGCommand<T extends TGCommandArgs>({ command, ...other }: TGCommand<T>) {
  // Check for duplicate commands
  if (commands.has(command)) {
    logger.warn(`Command ${command} already exists, overwriting`);
    botClient.bot.removeTextListener(new RegExp(`^/${command}(\?.*)?$`));
  }
  // Save command to collection
  commands.set(command, { command, ...other });

  // Listen and match parameter messages
  botClient.bot.onText(new RegExp(`^/${command}(\?.*)?$`), async (msg, match) => {
    // Execute command
    await dispatchCommand(command, msg, match);
  });
}
```

Finally, you can provide a `setup` method to invoke the TG API's `getMyCommands` to retrieve old commands and check whether they need updating. If there are new commands, call `setMyCommands` to update them.

Here’s the implementation of `setupTGCommands`:

```typescript
export async function setupTGCommands(): Promise<boolean> {
  // Check and create temporary folder directory
  if ((await fs.access(path.resolve('temp')).catch(() => false)) === false) {
    await fs.mkdir(path.resolve('temp'));
  }

  try {
    // Get old commands
    const oldCommands = await botClient.bot.getMyCommands();
    const oldCommandsHash = new Set(oldCommands.map(({ command }) => command));
    let updated = false; // Flag to indicate updates
    const newCommands: TelegramBot.BotCommand[] = [];
    for (const [command, config] of commands) {
      // If new commands exist, set update flag
      if (!oldCommandsHash.has(command)) updated = true;
      try {
        // Execute setup parameters for the command
        await config.setup?.({ command, client: botClient, data: config.data });
      } catch (error) {
        logger.error(`Error setting up command ${command}: ${(error as Error)?.message}`);
      }
      // Add new command to newCommands array
      newCommands.push({ command, description: config.description });
    }
    // Update commands if needed
    if (updated) {
      logger.info('Updating Telegram commands');
      await botClient.bot.setMyCommands(newCommands);
    }
    return updated;
  } catch (error) {
    logger.error(error);
    return setupTGCommands(); // Retry automatically
  }
}
```

#### 0x3 Telegram Query Callback

In Telegram, non-command scenarios—such as interactive operations frequently seen in inline buttons—are handled through **Query Callbacks**. These callbacks work similarly to commands but are used for branching interactions rather than entry points for logical flows.

##### 0x3.1 Implementing `defineTGQueryCallback`

We can define query callbacks using a similar approach to the `defineCommand` function, encapsulating them in a way that allows reuse across all Telegram messages with `inline_keyboard` buttons. The implementation is similar to `defineCommand`, so let’s jump into the code for reference.

```typescript
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

    // Check required args
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
```

##### 0x3.2 Usage of `defineTGQueryCallback`

Here are some common query callback definitions that you can use for your Telegram Bot.

###### 0x3.2.1 Close Message

```typescript
export const close = defineTGQueryCallback({
  query: 'close',
  text: '❌ Close',
  callback: async ({ client, msg }) => {
    if (!msg) return;

    await client.bot.editMessageText('This message has been closed!', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[del]],
      },
    });
  },
});
```

###### 0x3.2.2 Delete Message

```typescript
export const del = defineTGQueryCallback({
  query: 'delete',
  text: '🗑 Delete',
  callback: async ({ client, msg }) => {
    if (!msg) return;

    await client.bot.deleteMessage(msg.chat.id, msg.message_id);
  },
});
```

###### 0x3.2.3 Actual Usage

```typescript
// Centralized definition
export const Queries = {
  /** Close message */
  close,
  /** Delete message */
  del,
};

// Actual usage
const reply_markup = {
  inline_keyboard: [[Queries.close], [Queries.del]],
};
```
