import { LLMProvider } from '../llm/types'
import { analyseArchitecture, StrideResult } from '../agents/strideAgent'
import { db } from '../db/client'
import { PipelineRun } from './stateMachine'
import { config } from '../config'

interface DocRow {
  filename: string
  path: string
  content: string
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(tasks.length).fill(null)
  let next = 0

  async function worker() {
    while (next < tasks.length) {
      const i = next++
      try {
        results[i] = await tasks[i]()
      } catch (err) {
        console.error(`[stridePool] doc ${i} failed:`, err instanceof Error ? err.message : err)
        results[i] = null
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

export async function runStridePool(
  run: PipelineRun,
  provider: LLMProvider
): Promise<StrideResult[]> {
  const docs = db
    .prepare('SELECT filename, path, content FROM ingested_docs WHERE run_id = ?')
    .all(run.id) as DocRow[]

  if (docs.length === 0) {
    throw new Error('No documents found for STRIDE analysis')
  }

  const tasks = docs.map((doc) => () => analyseArchitecture(doc, provider))
  const rawResults = await runWithConcurrency(tasks, config.pipeline.concurrency)
  const succeeded = rawResults.filter((r): r is StrideResult => r !== null)

  if (succeeded.length === 0) {
    throw new Error('All STRIDE analyses failed — no documents processed')
  }

  const failCount = rawResults.length - succeeded.length
  if (failCount > 0) {
    console.warn(`[stridePool] ${failCount}/${rawResults.length} document(s) quarantined`)
  }

  return succeeded
}
