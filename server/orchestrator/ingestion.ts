import { db } from '../db/client'
import { listArchitectureDocs, readFile } from '../connectors/github'
import { transition, PipelineRun } from './stateMachine'
import { config } from '../config'

interface IngestedDoc {
  run_id: string
  filename: string
  path: string
  content: string
  sha: string
  created_at: string
}

async function withBackoff<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === maxAttempts - 1) throw err
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw new Error('Unreachable')
}

const insertDoc = db.prepare(`
  INSERT INTO ingested_docs (run_id, filename, path, content, sha, created_at)
  VALUES (@run_id, @filename, @path, @content, @sha, @created_at)
`)

export async function runIngestion(run: PipelineRun): Promise<void> {
  const { github_repo, folder_path } = run

  try {
    const docs = await withBackoff(() =>
      listArchitectureDocs(github_repo, folder_path)
    )

    for (const meta of docs) {
      const { content, sha } = await withBackoff(() =>
        readFile(github_repo, meta.path)
      )

      const doc: IngestedDoc = {
        run_id: run.id,
        filename: meta.filename,
        path: meta.path,
        content,
        sha,
        created_at: new Date().toISOString(),
      }

      insertDoc.run(doc)
    }

    transition(run.id, 'ANALYSING', `Ingested ${docs.length} document(s)`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(run.id, 'REJECTED', `Ingestion failed: ${detail}`)
    console.error(`[ingestion] run ${run.id} failed:`, detail)
  }
}
