'use strict'

import * as fs from 'fs'
import * as path from 'path'
import { LLMProvider, LLMMessage } from '../llm/types'
import { PipelineRun, transition } from '../orchestrator/stateMachine'
import { commitFile } from '../connectors/github'
import { AnalysisResult } from '../orchestrator/analysisPool'
import { AttackMapping } from './attackMappingAgent'
import { LlmTop10Finding } from './llmTop10Agent'

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/summarise.md'),
  'utf8'
)

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function renderAttackSection(analysisResults: AnalysisResult[]): string | null {
  const rows: string[] = []
  for (const r of analysisResults) {
    if (!r.attack || r.attack.mappings.length === 0) continue
    for (const m of r.attack.mappings) {
      rows.push(
        `| ${escapeCell(r.filename)} | ${m.stride_threat_id} | ${escapeCell(m.tactic)} | ${escapeCell(m.technique_ids.join(', '))} | ${escapeCell(m.rationale)} |`
      )
    }
  }

  if (rows.length === 0) return null

  return [
    '## MITRE ATT&CK Tactic Mapping',
    '',
    'This section maps the STRIDE threats identified above to MITRE ATT&CK Enterprise tactics and techniques an adversary could plausibly use to realise them. Mappings are presented per source architecture.',
    '',
    '| Source | STRIDE ID | Tactic | Technique IDs | Rationale |',
    '|---|---|---|---|---|',
    rows.join('\n'),
  ].join('\n')
}

function renderLlmTop10Section(analysisResults: AnalysisResult[]): string | null {
  const rows: string[] = []
  const skippedFilenames: string[] = []
  const ranButEmpty: string[] = []

  for (const r of analysisResults) {
    if (!r.llmTop10) continue
    if (r.llmTop10.skipped) {
      skippedFilenames.push(r.filename)
      continue
    }
    if (r.llmTop10.findings.length === 0) {
      ranButEmpty.push(r.filename)
      continue
    }
    for (const f of r.llmTop10.findings) {
      rows.push(
        `| ${escapeCell(r.filename)} | ${f.finding_id} | ${f.llm_risk_id} ${escapeCell(f.name)} | ${f.severity} | ${f.likelihood} | ${escapeCell(f.description)} | ${escapeCell(f.affected_component)} | ${escapeCell(f.mitigation)} |`
      )
    }
  }

  if (rows.length === 0 && skippedFilenames.length === 0 && ranButEmpty.length === 0) {
    // OWASP LLM Top 10 was disabled for every doc — omit the section entirely.
    return null
  }

  const header = [
    '## OWASP LLM Top 10 Findings',
    '',
    'This section lists LLM-specific risks identified across the AI / ML components of the analysed architectures. Findings are drawn from the OWASP LLM Top 10 v2.0 (2025).',
    '',
  ]

  if (rows.length > 0) {
    header.push(
      '| Source | Finding | Risk | Severity | Likelihood | Description | Affected Component | Mitigation |',
      '|---|---|---|---|---|---|---|---|',
      rows.join('\n')
    )
  } else {
    header.push('_No LLM-specific risks were identified for the analysed architectures._')
  }

  const notes: string[] = []
  if (skippedFilenames.length > 0) {
    notes.push(
      `- Skipped (no AI/ML signals detected): ${skippedFilenames.join(', ')}`
    )
  }
  if (ranButEmpty.length > 0) {
    notes.push(
      `- Analysed but no LLM-specific findings: ${ranButEmpty.join(', ')}`
    )
  }
  if (notes.length > 0) {
    header.push('', '### Coverage Notes', '', notes.join('\n'))
  }

  return header.join('\n')
}

export async function summariseDocs(
  analysisResults: AnalysisResult[],
  provider: LLMProvider,
  options: { run: PipelineRun; outputPath: string }
): Promise<void> {
  const filenames = analysisResults.map((r) => r.filename).join(', ')

  // The LLM summariser consolidates STRIDE output (semantic de-duplication,
  // severity normalisation, cross-source fusion). ATT&CK and LLM Top 10
  // sections are appended deterministically below — their data is already
  // structured, so a second LLM pass would add cost without adding value.
  const docSections = analysisResults
    .map((r) => `[STRIDE document for ${r.filename}]\n\n${r.stride.strideMd}`)
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

  const sections = [response.content.trimEnd()]
  const attackSection = renderAttackSection(analysisResults)
  const llmTop10Section = renderLlmTop10Section(analysisResults)
  if (attackSection) sections.push(attackSection)
  if (llmTop10Section) sections.push(llmTop10Section)

  const finalMarkdown = sections.join('\n\n')

  await commitFile(
    options.run.github_repo,
    options.outputPath,
    finalMarkdown,
    `chore: add consolidated threat model [run ${options.run.id}]`
  )

  transition(options.run.id, 'AWAITING_APPROVAL', `Committed to ${options.outputPath}`)
}
