export interface AwsComponent {
  service: string
  component: string
  proposedMitigation: string
  strideContext: string
}

const AWS_SERVICES = [
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
  'SQS',
  'SNS',
  'DynamoDB',
  'ElastiCache',
  'Cognito',
  'WAF',
  'Shield',
  'GuardDuty',
  'Secrets Manager',
]

const STRIDE_HEADINGS = [
  'Spoofing',
  'Tampering',
  'Repudiation',
  'Information Disclosure',
  'Denial of Service',
  'Elevation of Privilege',
]

function findStrideContext(lines: string[], lineIndex: number): string {
  for (let i = lineIndex; i >= 0; i--) {
    const line = lines[i]
    if (line.startsWith('###')) {
      for (const category of STRIDE_HEADINGS) {
        if (line.includes(category)) return category
      }
    }
  }
  return 'Unknown'
}

function findMitigation(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 3)
  const end = Math.min(lines.length - 1, lineIndex + 3)
  for (let i = start; i <= end; i++) {
    const line = lines[i]
    if (line.includes('Mitigation') || line.includes('Recommendation')) {
      return line.replace(/^\s*[-*|#]+\s*/, '').trim().slice(0, 200)
    }
  }
  return ''
}

function extractSurroundingText(line: string, service: string): string {
  const idx = line.indexOf(service)
  if (idx === -1) return line.slice(0, 80)
  const start = Math.max(0, idx - 40)
  const end = Math.min(line.length, idx + service.length + 40)
  return line.slice(start, end).trim()
}

export function extractAwsComponents(enrichedMd: string): AwsComponent[] {
  const lines = enrichedMd.split('\n')
  const results: AwsComponent[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const service of AWS_SERVICES) {
      if (!line.includes(service)) continue

      const component = extractSurroundingText(line, service)
      const proposedMitigation = findMitigation(lines, i)
      const strideContext = findStrideContext(lines, i)

      results.push({ service, component, proposedMitigation, strideContext })
    }
  }

  return results
}
