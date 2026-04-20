import { PipelineRun } from '../orchestrator/stateMachine'
import { markdownToConfluenceXhtml, validateXhtml } from '../connectors/markdownToConfluence'
import { ensurePageHierarchy, upsertPage } from '../connectors/confluence'
import { config } from '../config'

export async function publishToConfluence(params: {
  run: PipelineRun
  markdownContent: string
}): Promise<{ pageUrl: string }> {
  const { run, markdownContent } = params

  const xhtml = markdownToConfluenceXhtml(markdownContent)
  if (!validateXhtml(xhtml)) {
    throw new Error(`XHTML conversion produced invalid output for run ${run.id}`)
  }

  const parentId = await ensurePageHierarchy(run.project_id)

  const page = await upsertPage(
    config.confluence.spaceId,
    parentId,
    `Threat Model: ${run.project_id}`,
    xhtml
  )

  return { pageUrl: page.url }
}
