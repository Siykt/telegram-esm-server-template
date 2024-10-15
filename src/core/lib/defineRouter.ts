import { Middleware } from 'koa';
import Router from 'koa-router';

export interface RouterOptions {
  prefix?: string;
  options?: Router.IRouterOptions;
  middlewares?: Middleware[];
  setup?: () => Promise<void>;
  routes?: Router[];
  health?: boolean;
}

let setups: Required<RouterOptions>['setup'][] = [];

export const routerSetup = async () => {
  for (const setup of setups) {
    await setup();
  }

  // clear setups
  setups = [];
};

export function defineRouter(options: RouterOptions) {
  const router = new Router({ prefix: options.prefix, ...options.options });

  if (options.health) {
    router.get('/health', (ctx) => (ctx.body = 'OK'));
  }

  if (options.middlewares) {
    router.use(...options.middlewares);
  }

  options.routes?.forEach((route) => {
    router.use(route.routes());
  });

  if (options.setup) {
    setups.push(options.setup);
  }

  return router;
}
