import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from '../../server/llm/types'
import { mapStrideToAttack } from '../../server/agents/attackMappingAgent'
import { StrideResult } from '../../server/agents/strideAgent'

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

const sampleStride: StrideResult = {
  filename: 'sample-architecture.md',
  strideMd: '# Threat Model\n\n| Threat ID | ... |\n| TM-001 | ... |',
}

const validOutput = JSON.stringify([
  {
    stride_threat_id: 'TM-001',
    tactic: 'Initial Access',
    technique_ids: ['T1190', 'T1133'],
    rationale:
      'An adversary could reach the exposed API Gateway by exploiting an unauthenticated route (T1190) or compromising VPN credentials into the VPC (T1133).',
  },
  {
    stride_threat_id: 'TM-002',
    tactic: 'Credential Access',
    technique_ids: ['T1552.001'],
    rationale:
      'The unencrypted configuration file described in TM-002 is an exemplar of credentials stored in files.',
  },
])

describe('attackMappingAgent.mapStrideToAttack', () => {
  it('parses valid JSON output on first attempt', async () => {
    const { provider, calls } = fakeProvider([validOutput])
    const result = await mapStrideToAttack(sampleStride, provider)
    assert.equal(result.filename, 'sample-architecture.md')
    assert.equal(result.mappings.length, 2)
    assert.equal(result.mappings[0].tactic, 'Initial Access')
    assert.deepEqual(result.mappings[0].technique_ids, ['T1190', 'T1133'])
    assert.equal(result.mappings[1].stride_threat_id, 'TM-002')
    assert.equal(calls(), 1, 'provider should be called exactly once on success')
  })

  it('retries once on malformed JSON and succeeds on retry', async () => {
    const { provider, calls } = fakeProvider(['this is not JSON at all', validOutput])
    const result = await mapStrideToAttack(sampleStride, provider)
    assert.equal(result.mappings.length, 2)
    assert.equal(calls(), 2, 'provider should be called twice: first + retry')
  })

  it('throws after two malformed responses', async () => {
    const { provider, calls } = fakeProvider(['not json', 'still not json'])
    await assert.rejects(
      () => mapStrideToAttack(sampleStride, provider),
      /failed JSON schema validation after 2 attempts/
    )
    assert.equal(calls(), 2)
  })

  it('rejects unknown tactic name', async () => {
    const bad = JSON.stringify([
      {
        stride_threat_id: 'TM-001',
        tactic: 'Very Bad Tactic',
        technique_ids: ['T1190'],
        rationale: 'invalid tactic',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('rejects technique_id with wrong format', async () => {
    const bad = JSON.stringify([
      {
        stride_threat_id: 'TM-001',
        tactic: 'Initial Access',
        technique_ids: ['t1190'], // lowercase — invalid
        rationale: 'lowercase technique id',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('rejects ATT&CK tactic ID in technique_ids field', async () => {
    const bad = JSON.stringify([
      {
        stride_threat_id: 'TM-001',
        tactic: 'Initial Access',
        technique_ids: ['TA0001'], // tactic ID, not technique
        rationale: 'used tactic id as technique id',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('accepts sub-technique IDs with dotted format', async () => {
    const good = JSON.stringify([
      {
        stride_threat_id: 'TM-001',
        tactic: 'Credential Access',
        technique_ids: ['T1552.001', 'T1552.004'],
        rationale: 'sub-technique IDs',
      },
    ])
    const { provider } = fakeProvider([good])
    const result = await mapStrideToAttack(sampleStride, provider)
    assert.deepEqual(result.mappings[0].technique_ids, ['T1552.001', 'T1552.004'])
  })

  it('rejects invalid stride_threat_id format', async () => {
    const bad = JSON.stringify([
      {
        stride_threat_id: 'TM-1', // not zero-padded to three digits
        tactic: 'Initial Access',
        technique_ids: ['T1190'],
        rationale: 'wrong id format',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('rejects empty technique_ids array', async () => {
    const bad = JSON.stringify([
      {
        stride_threat_id: 'TM-001',
        tactic: 'Initial Access',
        technique_ids: [],
        rationale: 'no techniques listed',
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('rejects non-array JSON response', async () => {
    const bad = JSON.stringify({ stride_threat_id: 'TM-001', tactic: 'Initial Access' })
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('accepts empty array as a valid response', async () => {
    const { provider } = fakeProvider(['[]'])
    const result = await mapStrideToAttack(sampleStride, provider)
    assert.equal(result.mappings.length, 0)
  })

  it('rejects missing required key', async () => {
    const bad = JSON.stringify([
      {
        stride_threat_id: 'TM-001',
        tactic: 'Initial Access',
        technique_ids: ['T1190'],
        // rationale missing
      },
    ])
    const { provider } = fakeProvider([bad, bad])
    await assert.rejects(() => mapStrideToAttack(sampleStride, provider))
  })

  it('tolerates leading/trailing whitespace in response', async () => {
    const padded = '\n\n  ' + validOutput + '\n\n  '
    const { provider } = fakeProvider([padded])
    const result = await mapStrideToAttack(sampleStride, provider)
    assert.equal(result.mappings.length, 2)
  })
})
