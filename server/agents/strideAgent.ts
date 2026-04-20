'use strict'

import * as fs from 'fs'
import * as path from 'path'
import { LLMProvider, LLMMessage } from '../llm/types'

export interface StrideResult {
  filename: string
  strideMd: string
}

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/stride.md'),
  'utf8'
)

const REQUIRED_SECTIONS = [
  '## Executive Summary',
  '## Threat Inventory',
  '## Detailed Analysis',
  '## AWS Services Identified',
  '## Assumptions and Limitations',
]

function validateSections(content: string): boolean {
  return REQUIRED_SECTIONS.every((section) => content.includes(section))
}

const TIMEOUT_MS = 5 * 60 * 1000

export async function analyseArchitecture(
  doc: { filename: string; path: string; content: string },
  provider: LLMProvider
): Promise<StrideResult> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`STRIDE analysis timed out after ${TIMEOUT_MS / 1000}s for file: ${doc.filename}`)),
      TIMEOUT_MS
    )
  )

  const analysisPromise = (async (): Promise<StrideResult> => {
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Architecture file: ${doc.filename}\n\n${doc.content}`,
      },
    ]

    const firstResponse = await provider.chat(messages, {
      cacheSystemPrompt: true,
      maxTokens: 4096,
    })

    if (validateSections(firstResponse.content)) {
      return { filename: doc.filename, strideMd: firstResponse.content }
    }

    const retryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: firstResponse.content },
      {
        role: 'user',
        content:
          'Your response is missing one or more required sections. The output must contain all of the following sections in order: ## Executive Summary, ## Threat Inventory, ## Detailed Analysis, ## AWS Services Identified, ## Assumptions and Limitations. Please produce the complete threat model report again, ensuring every required section is present.',
      },
    ]

    const secondResponse = await provider.chat(retryMessages, {
      cacheSystemPrompt: true,
      maxTokens: 4096,
    })

    if (validateSections(secondResponse.content)) {
      return { filename: doc.filename, strideMd: secondResponse.content }
    }

    throw new Error(
      `STRIDE analysis for "${doc.filename}" failed validation after 2 attempts. ` +
        `Missing sections: ${REQUIRED_SECTIONS.filter((s) => !secondResponse.content.includes(s)).join(', ')}`
    )
  })()

  return Promise.race([analysisPromise, timeoutPromise])
}
