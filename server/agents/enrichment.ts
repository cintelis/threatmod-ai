import { StrideResult } from './strideAgent'
import { PipelineRun, transition } from '../orchestrator/stateMachine'
import { commitFile } from '../connectors/github'
import { createProvider } from '../llm'
import { LLMMessage } from '../llm/types'
import { getControlsForCategory } from '../db/controlMappings'

const STRIDE_CATEGORIES = [
  'Spoofing',
  'Tampering',
  'Repudiation',
  'Information Disclosure',
  'Denial of Service',
  'Elevation of Privilege',
]

const AWS_SERVICE_NAMES = [
  'EC2',
  'S3',
  'RDS',
  'Lambda',
  'API Gateway',
  'CloudFront',
  'EKS',
  'KMS',
  'IAM',
  'VPC',
  'CloudTrail',
]

function extractStrideCategories(consolidatedMd: string): string[] {
  const found = new Set<string>()
  for (const line of consolidatedMd.split('\n')) {
    if (!line.includes('|')) continue
    for (const category of STRIDE_CATEGORIES) {
      if (line.includes(category)) {
        found.add(category)
      }
    }
  }
  return Array.from(found)
}

function buildControlMappingsSection(categories: string[]): string {
  const lines: string[] = [
    '## Control Mappings',
    '',
    'The following security controls apply to identified threats, mapped by STRIDE category.',
    '',
  ]

  for (const category of categories) {
    const controls = getControlsForCategory(category)
    if (controls.length === 0) continue

    lines.push(`### ${category}`)
    lines.push('| Framework | Control ID | Control Name | Description |')
    lines.push('|-----------|-----------|--------------|-------------|')

    for (const control of controls) {
      const framework = control.framework.replace(/\|/g, '\\|')
      const controlId = control.control_id.replace(/\|/g, '\\|')
      const controlName = control.control_name.replace(/\|/g, '\\|')
      const description = control.description.replace(/\|/g, '\\|')
      lines.push(`| ${framework} | ${controlId} | ${controlName} | ${description} |`)
    }

    lines.push('')
  }

  return lines.join('\n')
}

function extractAwsServices(consolidatedMd: string): string[] {
  const found: string[] = []
  for (const service of AWS_SERVICE_NAMES) {
    if (consolidatedMd.includes(service)) {
      found.push(service)
    }
  }
  return found
}

async function buildAwsBestPracticesSection(
  awsServices: string[],
  strideCategories: string[]
): Promise<string> {
  if (awsServices.length === 0) {
    return '## AWS Best Practices\n\nNo AWS services identified in this architecture.\n'
  }

  const provider = createProvider()

  const systemMessage: LLMMessage = {
    role: 'system',
    content:
      'You are an AWS security specialist. For each AWS service listed, provide 3 specific, actionable security best practices in markdown table format with columns: AWS Service | Best Practice | Implementation Notes',
  }

  const userMessage: LLMMessage = {
    role: 'user',
    content: `AWS services identified: ${awsServices.join(', ')}\n\nRelevant STRIDE categories for context: ${strideCategories.join(', ')}`,
  }

  const response = await provider.chat([systemMessage, userMessage], {
    maxTokens: 2048,
  })

  return `## AWS Best Practices\n\n${response.content}\n`
}

export async function enrichDocument(params: {
  consolidatedMd: string
  strideResults: StrideResult[]
  run: PipelineRun
  outputPath: string
  outputSha?: string
}): Promise<void> {
  const categories = extractStrideCategories(params.consolidatedMd)

  const controlMappingsSection = buildControlMappingsSection(categories)

  const awsServices = extractAwsServices(params.consolidatedMd)
  const awsBestPracticesSection = await buildAwsBestPracticesSection(awsServices, categories)

  const enrichedMd = `${params.consolidatedMd}\n\n${controlMappingsSection}\n${awsBestPracticesSection}`

  await commitFile(
    params.run.github_repo,
    params.outputPath,
    enrichedMd,
    `chore: enrich threat model with controls and AWS best practices [run ${params.run.id}]`,
    params.outputSha
  )

  transition(params.run.id, 'VERIFYING_AWS', 'Enriched with control mappings and AWS best practices')
}
