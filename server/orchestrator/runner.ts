import { createProvider } from '../llm'
import { runIngestion } from './ingestion'
import { runAnalysisPool } from './analysisPool'
import { summariseDocs } from '../agents/summariser'
import { enrichDocument } from '../agents/enrichment'
import { transition, getState, PipelineRun } from './stateMachine'
import { readFile } from '../connectors/github'
import { triggerApproval } from '../connectors/powerAutomate'
import { config } from '../config'
import { runVerification } from './verificationRunner'

export async function runPipeline(run: PipelineRun): Promise<void> {
  const provider = createProvider()

  await runIngestion(run)

  const afterIngestion = getState(run.id)
  if (!afterIngestion || afterIngestion.run.status !== 'ANALYSING') return

  let analysisResults
  try {
    analysisResults = await runAnalysisPool(afterIngestion.run, provider)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(run.id, 'REJECTED', `Analysis failed: ${detail}`)
    return
  }

  transition(run.id, 'SUMMARISING', `${analysisResults.length} architecture(s) analysed`)

  const afterAnalysis = getState(run.id)!
  const outputPath = `${config.github.outputFolder}/${afterAnalysis.run.project_id}-threat-model.md`

  try {
    await summariseDocs(analysisResults, provider, { run: afterAnalysis.run, outputPath })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(run.id, 'REJECTED', `Summarisation failed: ${detail}`)
    return
  }

  const documentUrl = `https://github.com/${run.github_repo}/blob/main/${outputPath}`
  const callbackUrl = `${config.serverBaseUrl}/api/v1/pipeline/approval-callback`

  try {
    await triggerApproval({
      runId: run.id,
      documentUrl,
      summary: `Threat model ready for review — ${analysisResults.length} architecture(s) analysed`,
      approverEmail: config.pipeline.approverEmail,
      callbackUrl,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[runner] Failed to trigger approval workflow: ${detail}`)
  }
}

export async function continueAfterApproval(runId: string): Promise<void> {
  const state = getState(runId)
  if (!state || state.run.status !== 'ENRICHING') return

  const run = state.run
  const outputPath = `${config.github.outputFolder}/${run.project_id}-threat-model.md`

  let consolidatedMd: string
  let outputSha: string | undefined

  try {
    const result = await readFile(run.github_repo, outputPath)
    consolidatedMd = result.content
    outputSha = result.sha
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(runId, 'REJECTED', `Failed to read consolidated document for enrichment: ${detail}`)
    return
  }

  try {
    await enrichDocument({ consolidatedMd, strideResults: [], run, outputPath, outputSha })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(runId, 'REJECTED', `Enrichment failed: ${detail}`)
    return
  }

  setImmediate(() => runVerification(runId))
}
