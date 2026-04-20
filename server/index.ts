import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pipelineRoutes } from './routes/pipeline'
import { approvalRoutes } from './routes/approval'
import { config } from './config'
import { startApprovalWatcher } from './orchestrator/approvalWatcher'
import { checkDbHealth } from './db/client'
import { requireBearerToken } from './middleware/auth'

const app = new Hono()

app.get('/health', async (c) => {
  const dbOk = checkDbHealth()
  return c.json({ status: dbOk ? 'ok' : 'degraded', timestamp: new Date().toISOString(), db: dbOk ? 'ok' : 'error' })
})

app.use('/api/v1/pipeline/*', requireBearerToken)
app.route('/api/v1/pipeline', pipelineRoutes)
app.route('/api/v1/pipeline', approvalRoutes)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Threatmod server running on http://localhost:${info.port}`)
  startApprovalWatcher()
})
