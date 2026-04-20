import { LLMProvider } from '../llm/types'
import { analyseArchitecture, StrideResult } from '../agents/strideAgent'
import {
  mapStrideToAttack,
  AttackMappingResult,
} from '../agents/attackMappingAgent'
import {
  analyseLlmTop10,
  LlmTop10Result,
  hasAiComponents,
} from '../agents/llmTop10Agent'
import { db } from '../db/client'
import { PipelineRun } from './stateMachine'
import { config } from '../config'

interface DocRow {
  filename: string
  path: string
  content: string
}

export interface AnalysisResult {
  filename: string
  stride: StrideResult
  attack?: AttackMappingResult
  llmTop10?: LlmTop10Result
}

// Re-export for downstream consumers that import StrideResult from the pool module.
export type { StrideResult } from '../agents/strideAgent'
export type { AttackMappingResult, AttackMapping } from '../agents/attackMappingAgent'
export type { LlmTop10Result, LlmTop10Finding } from '../agents/llmTop10Agent'

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
        console.error(
          `[analysisPool] doc ${i} failed:`,
          err instanceof Error ? err.message : err
        )
        results[i] = null
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

async function analyseDoc(
  doc: DocRow,
  provider: LLMProvider
): Promise<AnalysisResult> {
  // Step 1: STRIDE is always run and gates the rest.
  const stride = await analyseArchitecture(doc, provider)

  // Step 2: Resolve whether ATT&CK + LLM Top 10 should run for this doc.
  const enableAttack = config.pipeline.enableAttackMapping
  const llmTop10Mode = config.pipeline.enableLlmTop10

  const shouldRunLlmTop10 =
    llmTop10Mode === 'true' ||
    (llmTop10Mode === 'auto' && hasAiComponents(doc.content))

  // Step 3: Run the enabled methodologies in parallel.
  // Failures in ATT&CK or LLM Top 10 should NOT fail the whole doc —
  // STRIDE is the primary artifact; the other methodologies enrich it.
  const [attack, llmTop10] = await Promise.all([
    enableAttack
      ? mapStrideToAttack(stride, provider).catch((err) => {
          console.error(
            `[analysisPool] ATT&CK mapping failed for ${doc.filename}:`,
            err instanceof Error ? err.message : err
          )
          return undefined
        })
      : Promise.resolve(undefined),
    shouldRunLlmTop10
      ? analyseLlmTop10(doc, provider).catch((err) => {
          console.error(
            `[analysisPool] LLM Top 10 analysis failed for ${doc.filename}:`,
            err instanceof Error ? err.message : err
          )
          return undefined
        })
      : Promise.resolve(undefined),
  ])

  return {
    filename: doc.filename,
    stride,
    attack,
    llmTop10,
  }
}

export async function runAnalysisPool(
  run: PipelineRun,
  provider: LLMProvider
): Promise<AnalysisResult[]> {
  const docs = db
    .prepare(
      'SELECT filename, path, content FROM ingested_docs WHERE run_id = ?'
    )
    .all(run.id) as DocRow[]

  if (docs.length === 0) {
    throw new Error('No documents found for analysis')
  }

  const tasks = docs.map((doc) => () => analyseDoc(doc, provider))
  const rawResults = await runWithConcurrency(tasks, config.pipeline.concurrency)
  const succeeded = rawResults.filter(
    (r): r is AnalysisResult => r !== null
  )

  if (succeeded.length === 0) {
    throw new Error('All analyses failed — no documents processed')
  }

  const failCount = rawResults.length - succeeded.length
  if (failCount > 0) {
    console.warn(
      `[analysisPool] ${failCount}/${rawResults.length} document(s) quarantined`
    )
  }

  return succeeded
}
