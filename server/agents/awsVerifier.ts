import { invokeTool } from '../connectors/awsMcp'
import { AwsComponent } from './awsExtractor'

export interface VerificationFinding {
  service: string
  component: string
  proposedMitigation: string
  awsBestPractice: string
  status: 'aligned' | 'enhancement' | 'deviation' | 'deprecated'
  recommendation: string
}

export interface VerificationReport {
  findings: VerificationFinding[]
  criticalCount: number
  enhancementCount: number
  requiresReEnrichment: boolean
  wellArchitectedSummary: string
}

function classifyStatus(data: unknown): 'aligned' | 'enhancement' | 'deviation' | 'deprecated' {
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  if (text.includes('deprecated')) return 'deprecated'
  if (text.includes('deviation') || text.includes('contradicts')) return 'deviation'
  if (text.includes('enhancement') || text.includes('improvement')) return 'enhancement'
  return 'aligned'
}

function extractBestPractice(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 300)
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj['best_practice'] === 'string') return obj['best_practice']
    if (typeof obj['recommendation'] === 'string') return obj['recommendation']
    if (typeof obj['summary'] === 'string') return obj['summary']
    return JSON.stringify(data).slice(0, 300)
  }
  return String(data).slice(0, 300)
}

function extractRecommendation(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 300)
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj['recommendation'] === 'string') return obj['recommendation']
    if (typeof obj['action'] === 'string') return obj['action']
    return JSON.stringify(data).slice(0, 300)
  }
  return String(data).slice(0, 300)
}

function extractWellArchitectedSummary(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 500)
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj['summary'] === 'string') return obj['summary']
    if (typeof obj['alignment'] === 'string') return obj['alignment']
    return JSON.stringify(data).slice(0, 500)
  }
  return String(data).slice(0, 500)
}

export async function verifyAgainstAws(components: AwsComponent[]): Promise<VerificationReport> {
  const findings: VerificationFinding[] = []

  for (const component of components) {
    const mcpResponse = await invokeTool('lookup_service_security', {
      service: component.service,
      context: component.component,
      region: 'ap-southeast-2',
    })

    if (mcpResponse.status === 'unavailable') {
      findings.push({
        service: component.service,
        component: component.component,
        proposedMitigation: component.proposedMitigation,
        awsBestPractice: 'N/A',
        status: 'aligned',
        recommendation: 'MCP server unavailable — manual review recommended',
      })
      continue
    }

    if (mcpResponse.status === 'error') {
      findings.push({
        service: component.service,
        component: component.component,
        proposedMitigation: component.proposedMitigation,
        awsBestPractice: 'N/A',
        status: 'aligned',
        recommendation: `MCP error: ${mcpResponse.error ?? 'unknown'} — manual review recommended`,
      })
      continue
    }

    const status = classifyStatus(mcpResponse.data)
    const awsBestPractice = extractBestPractice(mcpResponse.data)
    const recommendation = extractRecommendation(mcpResponse.data)

    findings.push({
      service: component.service,
      component: component.component,
      proposedMitigation: component.proposedMitigation,
      awsBestPractice,
      status,
      recommendation,
    })
  }

  const waResponse = await invokeTool('check_well_architected', {
    component: 'architecture',
    decision: 'security review',
    pillar: 'security',
  })

  let wellArchitectedSummary: string
  if (waResponse.status === 'ok' && waResponse.data !== undefined) {
    wellArchitectedSummary = extractWellArchitectedSummary(waResponse.data)
  } else {
    wellArchitectedSummary = 'Well-Architected review unavailable — manual review recommended'
  }

  const criticalCount = findings.filter(
    (f) => f.status === 'deviation' || f.status === 'deprecated'
  ).length
  const enhancementCount = findings.filter((f) => f.status === 'enhancement').length
  const requiresReEnrichment = criticalCount > 0

  return { findings, criticalCount, enhancementCount, requiresReEnrichment, wellArchitectedSummary }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function buildVerificationSection(report: VerificationReport): string {
  const lines: string[] = [
    '## AWS Vendor Best Practice Verification',
    '',
    '### Service-Level Compliance Matrix',
    '| AWS Service | Component | Proposed Mitigation | AWS Best Practice | Status | Recommendation |',
    '|-------------|-----------|---------------------|-------------------|--------|----------------|',
  ]

  for (const f of report.findings) {
    lines.push(
      `| ${escapeCell(f.service)} | ${escapeCell(f.component)} | ${escapeCell(f.proposedMitigation)} | ${escapeCell(f.awsBestPractice)} | ${escapeCell(f.status)} | ${escapeCell(f.recommendation)} |`
    )
  }

  lines.push('')
  lines.push('### Critical Findings')
  lines.push('')

  const critical = report.findings.filter(
    (f) => f.status === 'deviation' || f.status === 'deprecated'
  )
  if (critical.length === 0) {
    lines.push('None identified.')
  } else {
    for (const f of critical) {
      lines.push(`- **${f.service}** (${f.status}): ${f.recommendation}`)
    }
  }

  lines.push('')
  lines.push('### Enhancement Opportunities')
  lines.push('')

  const enhancements = report.findings.filter((f) => f.status === 'enhancement')
  if (enhancements.length === 0) {
    lines.push('None identified.')
  } else {
    for (const f of enhancements) {
      lines.push(`- **${f.service}**: ${f.recommendation}`)
    }
  }

  lines.push('')
  lines.push('### Well-Architected Alignment Summary')
  lines.push('')
  lines.push(report.wellArchitectedSummary)
  lines.push('')

  return lines.join('\n')
}
