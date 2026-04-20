import { Hono } from 'hono'
import { createRun, transition, getState } from '../orchestrator/stateMachine'
import { runPipeline } from '../orchestrator/runner'
import { readFile } from '../connectors/github'
import { publishToConfluence } from '../agents/publisher'
import { config } from '../config'

interface TriggerBody {
  project_id: string
  github_repo: string
  folder_path: string
  approver_email: string
}

function isValidTriggerBody(body: unknown): body is TriggerBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.project_id === 'string' && b.project_id.length > 0 &&
    typeof b.github_repo === 'string' && b.github_repo.includes('/') &&
    typeof b.folder_path === 'string' && b.folder_path.length > 0 &&
    typeof b.approver_email === 'string' && b.approver_email.includes('@')
  )
}

export const pipelineRoutes = new Hono()

pipelineRoutes.post('/trigger', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!isValidTriggerBody(body)) {
    return c.json({
      error: 'Invalid request body. Required: project_id, github_repo (owner/repo), folder_path, approver_email',
    }, 400)
  }

  const run = createRun({
    project_id: body.project_id,
    github_repo: body.github_repo,
    folder_path: body.folder_path,
    approver_email: body.approver_email,
  })

  transition(run.id, 'INGESTING')

  setImmediate(() => runPipeline(run))

  return c.json({
    pipeline_run_id: run.id,
    status: 'INGESTING',
    created_at: run.created_at,
  }, 202)
})

pipelineRoutes.get('/:id/status', (c) => {
  const runId = c.req.param('id')
  const result = getState(runId)

  if (!result) {
    return c.json({ error: `Pipeline run not found: ${runId}` }, 404)
  }

  return c.json({
    pipeline_run_id: result.run.id,
    status: result.run.status,
    stages_completed: result.stages,
    updated_at: result.run.updated_at,
  })
})

pipelineRoutes.post('/:id/publish', async (c) => {
  const runId = c.req.param('id')
  const result = getState(runId)

  if (!result) {
    return c.json({ error: `Pipeline run not found: ${runId}` }, 404)
  }

  const { run } = result

  if (run.status !== 'VERIFYING_AWS' && run.status !== 'PUBLISHING') {
    return c.json({ error: `Cannot publish: pipeline is in state ${run.status}` }, 409)
  }

  transition(runId, 'PUBLISHING')

  const outputPath = `${config.github.outputFolder}/${run.project_id}-threat-model.md`

  async function attemptPublish(): Promise<{ pageUrl: string }> {
    const { content } = await readFile(run.github_repo, outputPath)
    return publishToConfluence({ run, markdownContent: content })
  }

  let pageUrl: string

  try {
    const publishResult = await attemptPublish()
    pageUrl = publishResult.pageUrl
  } catch (firstErr) {
    const firstDetail = firstErr instanceof Error ? firstErr.message : String(firstErr)
    console.error(JSON.stringify({ event: 'publish_failed', attempt: 1, runId, error: firstDetail }))

    await new Promise(resolve => setTimeout(resolve, 2000))

    try {
      const retryResult = await attemptPublish()
      pageUrl = retryResult.pageUrl
    } catch (secondErr) {
      const secondDetail = secondErr instanceof Error ? secondErr.message : String(secondErr)
      console.error(JSON.stringify({ event: 'publish_failed', attempt: 2, runId, error: secondDetail }))
      transition(runId, 'REJECTED', `Publication failed after 2 attempts: ${secondDetail}`)
      return c.json({ error: `Publication failed: ${secondDetail}` }, 500)
    }
  }

  transition(runId, 'COMPLETE', `Published to Confluence: ${pageUrl}`)
  return c.json({ ok: true, pageUrl })
})
