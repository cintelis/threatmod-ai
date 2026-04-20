'use strict'

import * as fs from 'fs'
import * as path from 'path'
import { LLMProvider, LLMMessage } from '../llm/types'
import { PipelineRun, transition } from '../orchestrator/stateMachine'
import { commitFile } from '../connectors/github'
import { StrideResult } from './strideAgent'

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/summarise.md'),
  'utf8'
)

export async function summariseDocs(
  strideResults: StrideResult[],
  provider: LLMProvider,
  options: { run: PipelineRun; outputPath: string }
): Promise<void> {
  const filenames = strideResults.map((r) => r.filename).join(', ')

  const docSections = strideResults
    .map((r) => `[STRIDE document for ${r.filename}]\n\n${r.strideMd}`)
    .join('\n\n---\n\n')

  const userContent = `Source architectures: ${filenames}\n\n---\n\n${docSections}`

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]

  const response = await provider.chat(messages, {
    cacheSystemPrompt: true,
    maxTokens: 8192,
  })

  await commitFile(
    options.run.github_repo,
    options.outputPath,
    response.content,
    `chore: add consolidated threat model [run ${options.run.id}]`
  )

  transition(options.run.id, 'AWAITING_APPROVAL', `Committed to ${options.outputPath}`)
}
