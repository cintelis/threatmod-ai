import { Hono } from 'hono'
import { transition } from '../orchestrator/stateMachine'
import { continueAfterApproval } from '../orchestrator/runner'
import { db } from '../db/client'

interface ApprovalRecord {
  id: number
  run_id: string
  triggered_at: string
  approver_email: string
  document_url: string
  status: string
  decision: string | null
  reviewer: string | null
  comments: string | null
  decided_at: string | null
  reminder_sent_at: string | null
  escalated_at: string | null
  created_at: string
}

interface CallbackBody {
  pipeline_run_id: string
  decision: 'approved' | 'rejected'
  reviewer: string
  comments: string
  timestamp: string
}

function isCallbackBody(body: unknown): body is CallbackBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.pipeline_run_id === 'string' && b.pipeline_run_id.length > 0 &&
    (b.decision === 'approved' || b.decision === 'rejected') &&
    typeof b.reviewer === 'string' && b.reviewer.length > 0 &&
    typeof b.comments === 'string' &&
    typeof b.timestamp === 'string' && b.timestamp.length > 0
  )
}

function processApprovalDecision(body: CallbackBody): void {
  const record = db.prepare(
    `SELECT * FROM approval_records WHERE run_id = ? AND status = 'pending' LIMIT 1`
  ).get(body.pipeline_run_id) as ApprovalRecord | undefined

  if (!record) {
    throw Object.assign(new Error('No pending approval record found'), { statusCode: 404 })
  }

  db.prepare(`
    UPDATE approval_records
    SET status = @status, decision = @decision, reviewer = @reviewer,
        comments = @comments, decided_at = @decided_at
    WHERE id = @id
  `).run({
    status: body.decision,
    decision: body.decision,
    reviewer: body.reviewer,
    comments: body.comments,
    decided_at: body.timestamp,
    id: record.id,
  })

  if (body.decision === 'approved') {
    transition(body.pipeline_run_id, 'ENRICHING', `Approved by ${body.reviewer}`)
    setImmediate(() => continueAfterApproval(body.pipeline_run_id))
  } else {
    transition(body.pipeline_run_id, 'REJECTED', `Rejected by ${body.reviewer}: ${body.comments}`)
  }

  console.log(JSON.stringify({
    event: 'approval_decision',
    run_id: body.pipeline_run_id,
    decision: body.decision,
    reviewer: body.reviewer,
    timestamp: body.timestamp,
  }))
}

export const approvalRoutes = new Hono()

approvalRoutes.post('/approval-callback', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!isCallbackBody(body)) {
    return c.json(
      { error: 'Invalid request body. Required: pipeline_run_id, decision (approved|rejected), reviewer, comments, timestamp' },
      400
    )
  }

  try {
    processApprovalDecision(body)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    if (e.statusCode === 404) {
      return c.json({ error: e.message ?? 'Not found' }, 404)
    }
    throw err
  }

  return c.json({ ok: true })
})

approvalRoutes.post('/mock-approve', async (c) => {
  const raw = await c.req.json().catch(() => null)

  if (!raw || typeof raw !== 'object') {
    return c.json({ error: 'Invalid request body. Required: pipeline_run_id' }, 400)
  }

  const b = raw as Record<string, unknown>

  if (typeof b.pipeline_run_id !== 'string' || b.pipeline_run_id.length === 0) {
    return c.json({ error: 'Invalid request body. Required: pipeline_run_id' }, 400)
  }

  const decision = b.decision === 'rejected' ? 'rejected' : 'approved'

  const syntheticBody: CallbackBody = {
    pipeline_run_id: b.pipeline_run_id,
    decision,
    reviewer: 'mock',
    comments: 'mock approval',
    timestamp: new Date().toISOString(),
  }

  try {
    processApprovalDecision(syntheticBody)
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string }
    if (e.statusCode === 404) {
      return c.json({ error: e.message ?? 'Not found' }, 404)
    }
    throw err
  }

  return c.json({ ok: true })
})
