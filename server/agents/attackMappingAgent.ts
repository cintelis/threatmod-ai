'use strict'

import * as fs from 'fs'
import * as path from 'path'
import { LLMProvider, LLMMessage } from '../llm/types'
import { StrideResult } from './strideAgent'

export interface AttackMapping {
  stride_threat_id: string
  tactic: string
  technique_ids: string[]
  rationale: string
}

export interface AttackMappingResult {
  filename: string
  mappings: AttackMapping[]
}

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/attack-mapping.md'),
  'utf8'
)

const VALID_TACTICS = new Set<string>([
  'Reconnaissance',
  'Resource Development',
  'Initial Access',
  'Execution',
  'Persistence',
  'Privilege Escalation',
  'Defense Evasion',
  'Credential Access',
  'Discovery',
  'Lateral Movement',
  'Collection',
  'Command and Control',
  'Exfiltration',
  'Impact',
])

const TECHNIQUE_ID_REGEX = /^T\d{4}(\.\d{3})?$/
const STRIDE_ID_REGEX = /^TM-\d{3}$/

const TIMEOUT_MS = 5 * 60 * 1000

function parseAndValidate(raw: string): AttackMapping[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null
    const e = entry as Record<string, unknown>

    if (typeof e.stride_threat_id !== 'string' || !STRIDE_ID_REGEX.test(e.stride_threat_id)) return null
    if (typeof e.tactic !== 'string' || !VALID_TACTICS.has(e.tactic)) return null
    if (!Array.isArray(e.technique_ids) || e.technique_ids.length === 0) return null
    for (const t of e.technique_ids) {
      if (typeof t !== 'string' || !TECHNIQUE_ID_REGEX.test(t)) return null
    }
    if (typeof e.rationale !== 'string' || e.rationale.length === 0) return null
  }

  return parsed as AttackMapping[]
}

export async function mapStrideToAttack(
  strideResult: StrideResult,
  provider: LLMProvider
): Promise<AttackMappingResult> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const handle = setTimeout(
      () => reject(new Error(`ATT&CK mapping timed out after ${TIMEOUT_MS / 1000}s for file: ${strideResult.filename}`)),
      TIMEOUT_MS
    )
    // Do not keep the Node event loop alive solely for this timer —
    // it is a safety net against a hung LLM call, not a heartbeat.
    handle.unref()
  })

  const analysisPromise = (async (): Promise<AttackMappingResult> => {
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Source file: ${strideResult.filename}\n\n${strideResult.strideMd}`,
      },
    ]

    const firstResponse = await provider.chat(messages, {
      cacheSystemPrompt: true,
      maxTokens: 4096,
    })

    let validated = parseAndValidate(firstResponse.content)
    if (validated !== null) {
      return { filename: strideResult.filename, mappings: validated }
    }

    const retryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: firstResponse.content },
      {
        role: 'user',
        content:
          'Your response was not a strictly-valid JSON array matching the required schema. Re-emit the mapping. Rules: (1) raw JSON only — no Markdown fences, no commentary before or after the array; (2) every array element must have exactly the keys stride_threat_id, tactic, technique_ids, rationale; (3) tactic must be one of the 14 MITRE ATT&CK Enterprise tactic names as listed in the reference table; (4) every technique_id must match ^T\\d{4}(\\.\\d{3})?$ (e.g. T1190 or T1566.002); (5) every stride_threat_id must match ^TM-\\d{3}$; (6) technique_ids must be a non-empty array.',
      },
    ]

    const secondResponse = await provider.chat(retryMessages, {
      cacheSystemPrompt: true,
      maxTokens: 4096,
    })

    validated = parseAndValidate(secondResponse.content)
    if (validated !== null) {
      return { filename: strideResult.filename, mappings: validated }
    }

    throw new Error(
      `ATT&CK mapping for "${strideResult.filename}" failed JSON schema validation after 2 attempts.`
    )
  })()

  return Promise.race([analysisPromise, timeoutPromise])
}
