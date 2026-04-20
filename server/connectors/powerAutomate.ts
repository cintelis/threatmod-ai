import { db } from '../db/client'
import { config } from '../config'

export async function triggerApproval(params: {
  runId: string
  documentUrl: string
  summary: string
  approverEmail: string
  callbackUrl: string
}): Promise<void> {
  const now = new Date().toISOString()

  if (!config.powerAutomate.webhookUrl) {
    console.warn(`[powerAutomate] webhookUrl not configured — skipping HTTP trigger for run ${params.runId}`)
  } else {
    const response = await fetch(config.powerAutomate.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_url: params.documentUrl,
        summary: params.summary,
        approver: params.approverEmail,
        callback_url: params.callbackUrl,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Power Automate webhook returned ${response.status} ${response.statusText} for run ${params.runId}`
      )
    }
  }

  db.prepare(`
    INSERT INTO approval_records (run_id, triggered_at, approver_email, document_url, status, created_at)
    VALUES (@run_id, @triggered_at, @approver_email, @document_url, @status, @created_at)
  `).run({
    run_id: params.runId,
    triggered_at: now,
    approver_email: params.approverEmail,
    document_url: params.documentUrl,
    status: 'pending',
    created_at: now,
  })
}
