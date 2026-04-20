import { MiddlewareHandler } from 'hono'
import { config } from '../config'

export const requireBearerToken: MiddlewareHandler = async (c, next) => {
  const apiKey = config.pipeline.apiKey
  if (!apiKey) return next()
  const auth = c.req.header('Authorization') ?? ''
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
}
