'use strict'

import * as fs from 'fs'
import * as path from 'path'
import { LLMProvider, LLMMessage } from '../llm/types'

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export type Likelihood = 'High' | 'Medium' | 'Low'

export interface LlmTop10Finding {
  llm_risk_id: string
  name: string
  finding_id: string
  description: string
  affected_component: string
  severity: Severity
  likelihood: Likelihood
  mitigation: string
}

export interface LlmTop10Result {
  filename: string
  findings: LlmTop10Finding[]
  skipped?: boolean
}

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/llm-top10.md'),
  'utf8'
)

const VALID_LLM_IDS = new Set<string>([
  'LLM01',
  'LLM02',
  'LLM03',
  'LLM04',
  'LLM05',
  'LLM06',
  'LLM07',
  'LLM08',
  'LLM09',
  'LLM10',
])

const CANONICAL_NAMES: Record<string, string> = {
  LLM01: 'Prompt Injection',
  LLM02: 'Sensitive Information Disclosure',
  LLM03: 'Supply Chain',
  LLM04: 'Data and Model Poisoning',
  LLM05: 'Improper Output Handling',
  LLM06: 'Excessive Agency',
  LLM07: 'System Prompt Leakage',
  LLM08: 'Vector and Embedding Weaknesses',
  LLM09: 'Misinformation',
  LLM10: 'Unbounded Consumption',
}

const FINDING_ID_REGEX = /^LT-\d{3}$/
const VALID_SEVERITY = new Set<Severity>(['Critical', 'High', 'Medium', 'Low'])
const VALID_LIKELIHOOD = new Set<Likelihood>(['High', 'Medium', 'Low'])

const AI_KEYWORD_REGEX =
  /\b(llm|llms|gpt|claude|openai|anthropic|chatgpt|langchain|llama|huggingface|embeddings?|rag|genai|bedrock|copilots?)\b/i

const AI_SUBSTRINGS: readonly string[] = [
  'large language model',
  'generative ai',
  'hugging face',
  'retrieval augmented',
  'retrieval-augmented',
  'ai agent',
  'ai model',
  'vector database',
  'vector db',
  'vectordb',
  'prompt engineering',
  'azure openai',
  'open ai',
  'fine-tun',
  'finetun',
  'vertex ai',
]

/**
 * Cheap pre-check: scan the architecture content for AI/ML signals.
 * Returns true if any keyword is present. Intentionally permissive —
 * a false-positive run costs one LLM call; a false-negative misses a
 * real AI risk, which is worse.
 */
export function hasAiComponents(content: string): boolean {
  if (AI_KEYWORD_REGEX.test(content)) return true
  const lower = content.toLowerCase()
  for (const s of AI_SUBSTRINGS) {
    if (lower.includes(s)) return true
  }
  return false
}

const TIMEOUT_MS = 5 * 60 * 1000

function parseAndValidate(raw: string): LlmTop10Finding[] | null {
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

    if (typeof e.llm_risk_id !== 'string' || !VALID_LLM_IDS.has(e.llm_risk_id)) return null
    if (typeof e.name !== 'string' || CANONICAL_NAMES[e.llm_risk_id] !== e.name) return null
    if (typeof e.finding_id !== 'string' || !FINDING_ID_REGEX.test(e.finding_id)) return null
    if (typeof e.description !== 'string' || e.description.length === 0) return null
    if (typeof e.affected_component !== 'string' || e.affected_component.length === 0) return null
    if (typeof e.severity !== 'string' || !VALID_SEVERITY.has(e.severity as Severity)) return null
    if (typeof e.likelihood !== 'string' || !VALID_LIKELIHOOD.has(e.likelihood as Likelihood)) return null
    if (typeof e.mitigation !== 'string' || e.mitigation.length === 0) return null
  }

  return parsed as LlmTop10Finding[]
}

export async function analyseLlmTop10(
  doc: { filename: string; path: string; content: string },
  provider: LLMProvider
): Promise<LlmTop10Result> {
  // Pre-check: skip without an LLM call when no AI/ML signals are present.
  if (!hasAiComponents(doc.content)) {
    return { filename: doc.filename, findings: [], skipped: true }
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    const handle = setTimeout(
      () =>
        reject(
          new Error(
            `LLM Top 10 analysis timed out after ${TIMEOUT_MS / 1000}s for file: ${doc.filename}`
          )
        ),
      TIMEOUT_MS
    )
    // See attackMappingAgent.ts — do not keep the event loop alive for this safety-net timer.
    handle.unref()
  })

  const analysisPromise = (async (): Promise<LlmTop10Result> => {
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

    let validated = parseAndValidate(firstResponse.content)
    if (validated !== null) {
      return { filename: doc.filename, findings: validated }
    }

    const retryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: firstResponse.content },
      {
        role: 'user',
        content:
          'Your response was not a strictly-valid JSON array matching the required schema. Re-emit the findings. Rules: (1) raw JSON only — no Markdown fences, no commentary; (2) every entry must have exactly the keys llm_risk_id, name, finding_id, description, affected_component, severity, likelihood, mitigation; (3) llm_risk_id must match ^LLM0[1-9]$ or equal LLM10; (4) name must be the canonical OWASP LLM Top 10 name for that id; (5) finding_id must match ^LT-\\d{3}$ with sequential numbering from LT-001; (6) severity must be one of Critical, High, Medium, Low; (7) likelihood must be one of High, Medium, Low; (8) empty array [] is valid output when no categories apply.',
      },
    ]

    const secondResponse = await provider.chat(retryMessages, {
      cacheSystemPrompt: true,
      maxTokens: 4096,
    })

    validated = parseAndValidate(secondResponse.content)
    if (validated !== null) {
      return { filename: doc.filename, findings: validated }
    }

    throw new Error(
      `LLM Top 10 analysis for "${doc.filename}" failed JSON schema validation after 2 attempts.`
    )
  })()

  return Promise.race([analysisPromise, timeoutPromise])
}
