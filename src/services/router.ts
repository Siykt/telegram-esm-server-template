import { defineRouter } from '../core/lib/defineRouter.js'
import { restful } from '../middlewares/restful.js'

const apiRouter = defineRouter({
  prefix: '/api',
  health: true,
  middlewares: [restful],
  routes: [],
})

export const router = defineRouter({
  routes: [apiRouter],
})
