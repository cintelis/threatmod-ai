import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/client'

export type PipelineStatus =
  | 'IDLE'
  | 'INGESTING'
  | 'ANALYSING'
  | 'SUMMARISING'
  | 'AWAITING_APPROVAL'
  | 'ENRICHING'
  | 'VERIFYING_AWS'
  | 'PUBLISHING'
  | 'COMPLETE'
  | 'REJECTED'

export interface PipelineRun {
  id: string
  project_id: string
  github_repo: string
  folder_path: string
  approver_email: string
  status: PipelineStatus
  created_at: string
  updated_at: string
}

export interface StageLog {
  stage: string
  status: 'started' | 'completed' | 'failed'
  actor?: string
  detail?: string
  created_at: string
}

// REJECTED is reachable from any state; explicit pairs cover the happy path and loops.
const LEGAL_TRANSITIONS: ReadonlyMap<PipelineStatus, ReadonlySet<PipelineStatus>> = new Map([
  ['IDLE',              new Set<PipelineStatus>(['INGESTING', 'REJECTED'])],
  ['INGESTING',         new Set<PipelineStatus>(['ANALYSING', 'REJECTED'])],
  ['ANALYSING',         new Set<PipelineStatus>(['SUMMARISING', 'REJECTED'])],
  ['SUMMARISING',       new Set<PipelineStatus>(['AWAITING_APPROVAL', 'REJECTED'])],
  ['AWAITING_APPROVAL', new Set<PipelineStatus>(['ENRICHING', 'REJECTED'])],
  ['ENRICHING',         new Set<PipelineStatus>(['VERIFYING_AWS', 'REJECTED'])],
  ['VERIFYING_AWS',     new Set<PipelineStatus>(['PUBLISHING', 'ENRICHING', 'REJECTED'])],
  ['PUBLISHING',        new Set<PipelineStatus>(['COMPLETE', 'REJECTED'])],
  ['COMPLETE',          new Set<PipelineStatus>(['REJECTED'])],
  ['REJECTED',          new Set<PipelineStatus>()],
])

export function createRun(params: {
  project_id: string
  github_repo: string
  folder_path: string
  approver_email: string
}): PipelineRun {
  const now = new Date().toISOString()
  const run: PipelineRun = {
    id: uuidv4(),
    project_id: params.project_id,
    github_repo: params.github_repo,
    folder_path: params.folder_path,
    approver_email: params.approver_email,
    status: 'IDLE',
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO pipeline_runs (id, project_id, github_repo, folder_path, approver_email, status, created_at, updated_at)
    VALUES (@id, @project_id, @github_repo, @folder_path, @approver_email, @status, @created_at, @updated_at)
  `).run(run)

  return run
}

export function transition(
  runId: string,
  toState: PipelineStatus,
  detail?: string
): PipelineRun {
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRun | undefined
  if (!row) {
    throw new Error(`Run not found: ${runId}`)
  }

  const allowed = LEGAL_TRANSITIONS.get(row.status)
  if (!allowed || !allowed.has(toState)) {
    throw new Error(
      `Illegal transition: ${row.status} → ${toState} (run ${runId})`
    )
  }

  const now = new Date().toISOString()

  db.prepare(`
    UPDATE pipeline_runs SET status = @status, updated_at = @updated_at WHERE id = @id
  `).run({ status: toState, updated_at: now, id: runId })

  db.prepare(`
    INSERT INTO pipeline_stages (run_id, stage, status, actor, detail, created_at)
    VALUES (@run_id, @stage, @status, @actor, @detail, @created_at)
  `).run({
    run_id: runId,
    stage: toState,
    status: 'started',
    actor: null,
    detail: detail ?? null,
    created_at: now,
  })

  return { ...row, status: toState, updated_at: now }
}

export function getState(
  runId: string
): { run: PipelineRun; stages: StageLog[] } | null {
  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRun | undefined
  if (!run) return null

  const stages = db.prepare(
    'SELECT stage, status, actor, detail, created_at FROM pipeline_stages WHERE run_id = ? ORDER BY id ASC'
  ).all(runId) as StageLog[]

  return { run, stages }
}
