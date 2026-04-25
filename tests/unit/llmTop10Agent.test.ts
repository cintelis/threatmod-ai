import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from '../../server/llm/types'
import {
  analyseLlmTop10,
  hasAiComponents,
} from '../../server/agents/llmTop10Agent'

function fakeProvider(responses: string[]): { provider: LLMProvider; calls: () => number } {
  let callIndex = 0
  const provider: LLMProvider = {
    async chat(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      const content = responses[Math.min(callIndex, responses.length - 1)]
      callIndex++
      return { content, inputTokens: 0, outputTokens: 0 }
    },
  }
  return { provider, calls: () => callIndex }
}

// ------- fixtures ---------------------------------------------------------

const AI_DOC = {
  filename: 'ai-service.md',
  path: 'architectures/ai-service.md',
  content: `# AI-Powered Support Bot

Uses an LLM (Azure OpenAI GPT-4o) to answer customer questions.
Context is retrieved from a vector database via RAG.
Embeddings are generated with text-embedding-3-small.
`,
}

const NO_AI_DOC = {
  filename: 'classic-api.md',
  path: 'architectures/classic-api.md',
  content: `# Classic REST API

- AWS API Gateway in front of Lambda functions.
- RDS PostgreSQL for persistence.
- S3 for static assets.
- Cognito for authentication.
`,
}

const validOutput = JSON.stringify([
  {
    llm_risk_id: 'LLM01',
    name: 'Prompt Injection',
    finding_id: 'LT-001',
    description: 'Customer-supplied questions reach the LLM system prompt unsanitised, enabling injection payloads to override bot instructions.',
    affected_component: 'support-bot main handler',
    severity: 'High',
    likelihood: 'Medium',
    mitigation: 'Wrap user content in a delimited block and reject inputs containing known injection sigils at the API boundary.',
  },
  {
    llm_risk_id: 'LLM08',
    name: 'Vector and Embedding Weaknesses',
    finding_id: 'LT-002',
    description: 'The RAG vector store ingests untrusted documents without provenance checks, allowing poisoned entries to surface in retrieval.',
    affected_component: 'vector database ingestion pipeline',
    severity: 'Medium',
    likelihood: 'Low',
    mitigation: 'Require a signed origin claim on every document before indexing, and re-embed on updates.',
  },
])

// ------- hasAiComponents --------------------------------------------------

describe('hasAiComponents', () => {
  it('returns true for content with LLM keyword', () => {
    assert.equal(hasAiComponents('Uses an LLM to summarise text.'), true)
  })

  it('is case-insensitive', () => {
    assert.equal(hasAiComponents('Uses an llm'), true)
    assert.equal(hasAiComponents('Uses an LLM'), true)
    assert.equal(hasAiComponents('Uses a Gpt-4'), true)
  })

  it('detects common AI vendor names', () => {
    assert.equal(hasAiComponents('calls OpenAI API'), true)
    assert.equal(hasAiComponents('uses Anthropic Claude'), true)
    assert.equal(hasAiComponents('Claude Sonnet for summarisation'), true)
    assert.equal(hasAiComponents('hosted on AWS Bedrock'), true)
  })

  it('detects multi-word AI phrases', () => {
    assert.equal(hasAiComponents('large language model orchestration'), true)
    assert.equal(hasAiComponents('generative AI pipeline'), true)
    assert.equal(hasAiComponents('vector database lookups'), true)
    assert.equal(hasAiComponents('retrieval augmented generation'), true)
    assert.equal(hasAiComponents('retrieval-augmented generation'), true)
    assert.equal(hasAiComponents('Hugging Face transformers'), true)
    assert.equal(hasAiComponents('fine-tuned on customer data'), true)
    assert.equal(hasAiComponents('finetuned on customer data'), true)
    assert.equal(hasAiComponents('GCP Vertex AI endpoint'), true)
    assert.equal(hasAiComponents('prompt engineering workflow'), true)
  })

  it('detects RAG pattern as a standalone word', () => {
    assert.equal(hasAiComponents('uses a RAG pattern'), true)
  })

  it('respects word boundaries (no false positive on embedded substrings)', () => {
    // `llm` inside 'williamsllm' would false-match a naive substring check.
    assert.equal(hasAiComponents('the user williamslmith logs in'), false)
    // `rag` inside 'storage' must not match.
    assert.equal(hasAiComponents('s3 storage tier'), false)
    assert.equal(hasAiComponents('database storage layer'), false)
  })

  it('returns false for classic web/cloud architecture', () => {
    assert.equal(
      hasAiComponents(
        'AWS API Gateway fronts Lambda. RDS PostgreSQL is the persistence layer. S3 holds static assets. Cognito handles authentication.'
      ),
      false
    )
  })

  it('returns false for empty content', () => {
    assert.equal(hasAiComponents(''), false)
  })

  it('returns true for content with embedding keyword', () => {
    assert.equal(hasAiComponents('generate embeddings with a bi-encoder'), true)
  })
})

// ------- analyseLlmTop10 --------------------------------------------------

describe('llmTop10Agent.analyseLlmTop10', () => {
  it('skips without calling the provider when no AI signals are present', async () => {
    const { provider, calls } = fakeProvider(['this should never be read'])
    const result = await analyseLlmTop10(NO_AI_DOC, provider)
    assert.equal(calls(), 0, 'provider.chat must not be called when hasAiComponents is false')
    assert.equal(result.skipped, true)
    assert.equal(result.findings.length, 0)
  })

  it('runs the LLM when AI signals are present', async () => {
    const { provider, calls } = fakeProvider([validOutput])
    const result = await analyseLlmTop10(AI_DOC, provider)
    assert.equal(calls(), 1)
    assert.equal(result.skipped, undefined)
    assert.equal(result.findings.length, 2)
    assert.equal(result.findings[0].llm_risk_id, 'LLM01')
    assert.equal(result.findings[0].name, 'Prompt Injection')
  })

  it('retries once on malformed JSON and succeeds on retry', async () => {
    const { provider, calls } = fakeProvider(['not json', validOutput])
    const result = await analyseLlmTop10(AI_DOC, provider)
    assert.equal(result.findings.length, 2)
    assert.equal(calls(), 2)
  })

  it('throws after two malformed responses', async () => {
    const { provider } = fakeProvider(['bad', 'still bad'])
    await assert.rejects(
      () => analyseLlmTop10(AI_DOC, provider),
      /failed JSON schema validation after 2 attempts/
    )
  })

  it('rejects non-canonical name for llm_risk_id', async () => {
    const bad = JSON.stringify([
      {
        llm_risk_id: 'LLM01',
        name: 'Prompt injection', // lowercase 'injection' — wrong canonical name
        finding_id: 'LT-001',
        description: 'any',
        affected_component: 'any',
        severity: 'High',
        likelihood: 'Medium',
        mitigation: 'any',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => analyseLlmTop10(AI_DOC, provider))
  })

  it('rejects unknown llm_risk_id', async () => {
    const bad = JSON.stringify([
      {
        llm_risk_id: 'LLM99',
        name: 'Nonexistent Risk',
        finding_id: 'LT-001',
        description: 'any',
        affected_component: 'any',
        severity: 'High',
        likelihood: 'Medium',
        mitigation: 'any',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => analyseLlmTop10(AI_DOC, provider))
  })

  it('rejects invalid finding_id format', async () => {
    const bad = JSON.stringify([
      {
        llm_risk_id: 'LLM01',
        name: 'Prompt Injection',
        finding_id: 'LT-1', // not three digits
        description: 'any',
        affected_component: 'any',
        severity: 'High',
        likelihood: 'Medium',
        mitigation: 'any',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => analyseLlmTop10(AI_DOC, provider))
  })

  it('rejects severity outside the enum', async () => {
    const bad = JSON.stringify([
      {
        llm_risk_id: 'LLM01',
        name: 'Prompt Injection',
        finding_id: 'LT-001',
        description: 'any',
        affected_component: 'any',
        severity: 'Moderate', // not in {Critical, High, Medium, Low}
        likelihood: 'Medium',
        mitigation: 'any',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => analyseLlmTop10(AI_DOC, provider))
  })

  it('rejects likelihood outside the enum', async () => {
    const bad = JSON.stringify([
      {
        llm_risk_id: 'LLM01',
        name: 'Prompt Injection',
        finding_id: 'LT-001',
        description: 'any',
        affected_component: 'any',
        severity: 'High',
        likelihood: 'Certain', // not in {High, Medium, Low}
        mitigation: 'any',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => analyseLlmTop10(AI_DOC, provider))
  })

  it('accepts empty array as a valid response when nothing applies', async () => {
    const { provider } = fakeProvider(['[]'])
    const result = await analyseLlmTop10(AI_DOC, provider)
    assert.equal(result.findings.length, 0)
    assert.equal(result.skipped, undefined) // ran the LLM but got []
  })

  it('accepts all 10 canonical OWASP LLM categories', async () => {
    const allTen = JSON.stringify([
      { llm_risk_id: 'LLM01', name: 'Prompt Injection', finding_id: 'LT-001', description: 'x', affected_component: 'c', severity: 'High', likelihood: 'Medium', mitigation: 'm' },
      { llm_risk_id: 'LLM02', name: 'Sensitive Information Disclosure', finding_id: 'LT-002', description: 'x', affected_component: 'c', severity: 'High', likelihood: 'Medium', mitigation: 'm' },
      { llm_risk_id: 'LLM03', name: 'Supply Chain', finding_id: 'LT-003', description: 'x', affected_component: 'c', severity: 'Medium', likelihood: 'Low', mitigation: 'm' },
      { llm_risk_id: 'LLM04', name: 'Data and Model Poisoning', finding_id: 'LT-004', description: 'x', affected_component: 'c', severity: 'High', likelihood: 'Low', mitigation: 'm' },
      { llm_risk_id: 'LLM05', name: 'Improper Output Handling', finding_id: 'LT-005', description: 'x', affected_component: 'c', severity: 'High', likelihood: 'Medium', mitigation: 'm' },
      { llm_risk_id: 'LLM06', name: 'Excessive Agency', finding_id: 'LT-006', description: 'x', affected_component: 'c', severity: 'Critical', likelihood: 'Medium', mitigation: 'm' },
      { llm_risk_id: 'LLM07', name: 'System Prompt Leakage', finding_id: 'LT-007', description: 'x', affected_component: 'c', severity: 'Medium', likelihood: 'Medium', mitigation: 'm' },
      { llm_risk_id: 'LLM08', name: 'Vector and Embedding Weaknesses', finding_id: 'LT-008', description: 'x', affected_component: 'c', severity: 'Medium', likelihood: 'Low', mitigation: 'm' },
      { llm_risk_id: 'LLM09', name: 'Misinformation', finding_id: 'LT-009', description: 'x', affected_component: 'c', severity: 'High', likelihood: 'High', mitigation: 'm' },
      { llm_risk_id: 'LLM10', name: 'Unbounded Consumption', finding_id: 'LT-010', description: 'x', affected_component: 'c', severity: 'Medium', likelihood: 'High', mitigation: 'm' },
    ])
    const { provider } = fakeProvider([allTen])
    const result = await analyseLlmTop10(AI_DOC, provider)
    assert.equal(result.findings.length, 10)
    assert.equal(result.findings[0].llm_risk_id, 'LLM01')
    assert.equal(result.findings[9].llm_risk_id, 'LLM10')
  })
})
