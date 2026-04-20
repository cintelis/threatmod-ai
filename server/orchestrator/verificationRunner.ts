import { getState, transition } from './stateMachine'
import { readFile, commitFile } from '../connectors/github'
import { extractAwsComponents } from '../agents/awsExtractor'
import { verifyAgainstAws, buildVerificationSection } from '../agents/awsVerifier'
import { config } from '../config'

export async function runVerification(runId: string, maxReEnrichmentLoops = 2): Promise<void> {
  const state = getState(runId)
  if (!state || state.run.status !== 'VERIFYING_AWS') return

  const run = state.run
  const outputPath = `${config.github.outputFolder}/${run.project_id}-threat-model.md`

  let content: string
  let sha: string

  try {
    const result = await readFile(run.github_repo, outputPath)
    content = result.content
    sha = result.sha
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(runId, 'REJECTED', `Failed to read threat model for verification: ${detail}`)
    return
  }

  const components = extractAwsComponents(content)

  let report
  try {
    report = await verifyAgainstAws(components)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(runId, 'REJECTED', `AWS verification failed: ${detail}`)
    return
  }

  const verificationSection = buildVerificationSection(report)
  const updatedContent = `${content}\n\n${verificationSection}`

  try {
    await commitFile(
      run.github_repo,
      outputPath,
      updatedContent,
      `chore: append AWS verification report [run ${run.id}]`,
      sha
    )
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    transition(runId, 'REJECTED', `Failed to commit verification report: ${detail}`)
    return
  }

  if (report.requiresReEnrichment && maxReEnrichmentLoops > 0) {
    const loopNumber = 3 - maxReEnrichmentLoops
    transition(runId, 'ENRICHING', `Re-enrichment loop ${loopNumber} triggered`)

    setImmediate(async () => {
      const { continueAfterApproval } = await import('./runner')
      try {
        await continueAfterApproval(runId)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        transition(runId, 'REJECTED', `Re-enrichment loop failed: ${detail}`)
        return
      }

      const afterEnrichment = getState(runId)
      if (!afterEnrichment || afterEnrichment.run.status !== 'VERIFYING_AWS') return

      await runVerification(runId, maxReEnrichmentLoops - 1)
    })

    return
  }

  transition(
    runId,
    'PUBLISHING',
    `Verification complete — ${report.criticalCount} critical finding(s)`
  )
}
