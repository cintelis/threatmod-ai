import { transition } from './stateMachine'
import { db } from '../db/client'
import { config } from '../config'

interface PendingApproval {
  id: number
  run_id: string
  triggered_at: string
  approver_email: string
  reminder_sent_at: string | null
  escalated_at: string | null
}

function hoursElapsed(since: string): number {
  return (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60)
}

function checkPendingApprovals(): void {
  const records = db.prepare(
    `SELECT id, run_id, triggered_at, approver_email, reminder_sent_at, escalated_at
     FROM approval_records WHERE status = 'pending'`
  ).all() as PendingApproval[]

  const now = new Date().toISOString()

  for (const record of records) {
    const elapsed = hoursElapsed(record.triggered_at)

    if (elapsed >= 72) {
      db.prepare(
        `UPDATE approval_records SET status = 'expired' WHERE id = ?`
      ).run(record.id)

      try {
        transition(record.run_id, 'REJECTED', 'Approval timed out after 72h')
      } catch (err) {
        console.error(`[approvalWatcher] Failed to transition run ${record.run_id} to REJECTED:`, err)
      }
      continue
    }

    if (elapsed >= 48 && record.escalated_at === null) {
      console.log(
        `ESCALATION: escalating run ${record.run_id} to secondary approver ${config.powerAutomate.secondaryApproverEmail}`
      )
      db.prepare(
        `UPDATE approval_records SET escalated_at = ? WHERE id = ?`
      ).run(now, record.id)
    }

    if (elapsed >= 24 && record.reminder_sent_at === null) {
      console.log(
        `REMINDER: approval pending for run ${record.run_id}, approver ${record.approver_email}`
      )
      db.prepare(
        `UPDATE approval_records SET reminder_sent_at = ? WHERE id = ?`
      ).run(now, record.id)
    }
  }
}

export function startApprovalWatcher(): void {
  const intervalMs = Number(process.env.APPROVAL_CHECK_INTERVAL_MS) || 900000

  setInterval(() => {
    try {
      checkPendingApprovals()
    } catch (err) {
      console.error('[approvalWatcher] Unexpected error during poll:', err)
    }
  }, intervalMs)
}
