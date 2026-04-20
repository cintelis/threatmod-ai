import assert from 'assert'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const API_KEY = process.env.PIPELINE_API_KEY || ''

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`
  return h
}

async function poll(
  url: string,
  predicate: (body: Record<string, unknown>) => boolean,
  timeoutMs: number,
  intervalMs: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers: headers() })
    const body = await res.json() as Record<string, unknown>
    if (predicate(body)) return body
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(`poll timed out waiting for condition on ${url}`)
}

async function main(): Promise<void> {
  if (!process.env.E2E_ENABLED) {
    console.log('E2E tests skipped (set E2E_ENABLED=1 to run)')
    return
  }

  console.log(`Running E2E tests against ${BASE_URL}`)

  // 1. Health check
  {
    const res = await fetch(`${BASE_URL}/health`)
    assert.strictEqual(res.status, 200, 'Health check should return 200')
    const body = await res.json() as Record<string, unknown>
    assert.ok(
      body.status === 'ok' || body.status === 'degraded',
      `Health status should be ok or degraded, got: ${body.status}`
    )
    console.log('✓ GET /health')
  }

  // 2. Trigger pipeline
  let runId: string
  {
    const res = await fetch(`${BASE_URL}/api/v1/pipeline/trigger`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        project_id: 'e2e-test-project',
        github_repo: process.env.E2E_GITHUB_REPO || 'test-owner/test-repo',
        folder_path: 'architectures',
        approver_email: 'approver@example.com',
      }),
    })
    assert.strictEqual(res.status, 202, 'Trigger should return 202')
    const body = await res.json() as Record<string, unknown>
    assert.ok(typeof body.pipeline_run_id === 'string', 'Should return pipeline_run_id')
    runId = body.pipeline_run_id as string
    console.log(`✓ POST /api/v1/pipeline/trigger — run_id: ${runId}`)
  }

  // 3. Check status returns valid state object immediately
  {
    const res = await fetch(`${BASE_URL}/api/v1/pipeline/${runId}/status`, { headers: headers() })
    assert.strictEqual(res.status, 200, 'Status check should return 200')
    const body = await res.json() as Record<string, unknown>
    assert.ok(typeof body.status === 'string', 'Status should have a string status field')
    assert.ok(typeof body.pipeline_run_id === 'string', 'Status should have pipeline_run_id')
    console.log(`✓ GET /api/v1/pipeline/${runId}/status — state: ${body.status}`)
  }

  // 4. Poll until AWAITING_APPROVAL (timeout 60s)
  {
    const body = await poll(
      `${BASE_URL}/api/v1/pipeline/${runId}/status`,
      b => b.status === 'AWAITING_APPROVAL' || b.status === 'REJECTED',
      60000,
      2000
    )
    assert.strictEqual(body.status, 'AWAITING_APPROVAL', `Expected AWAITING_APPROVAL, got ${body.status}`)
    console.log('✓ Pipeline reached AWAITING_APPROVAL')
  }

  // 5. Mock-approve
  {
    const res = await fetch(`${BASE_URL}/api/v1/pipeline/mock-approve`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ pipeline_run_id: runId }),
    })
    assert.strictEqual(res.status, 200, 'Mock-approve should return 200')
    console.log('✓ POST /api/v1/pipeline/mock-approve')
  }

  // 6. Poll until enrichment/verification state
  {
    const body = await poll(
      `${BASE_URL}/api/v1/pipeline/${runId}/status`,
      b => ['ENRICHING', 'VERIFYING_AWS', 'PUBLISHING', 'COMPLETE', 'REJECTED'].includes(b.status as string),
      60000,
      2000
    )
    assert.ok(
      ['ENRICHING', 'VERIFYING_AWS', 'PUBLISHING', 'COMPLETE'].includes(body.status as string),
      `Expected post-approval state, got ${body.status}`
    )
    console.log(`✓ Pipeline advanced to ${body.status} after approval`)
  }

  // 7. Test publish endpoint — expect 409 (wrong state) or 200 (if VERIFYING_AWS/PUBLISHING)
  {
    const statusRes = await fetch(`${BASE_URL}/api/v1/pipeline/${runId}/status`, { headers: headers() })
    const statusBody = await statusRes.json() as Record<string, unknown>
    const currentStatus = statusBody.status as string

    const res = await fetch(`${BASE_URL}/api/v1/pipeline/${runId}/publish`, {
      method: 'POST',
      headers: headers(),
    })

    if (currentStatus === 'VERIFYING_AWS' || currentStatus === 'PUBLISHING') {
      assert.ok(res.status === 200 || res.status === 500, `Publish in ${currentStatus} should be 200 or 500, got ${res.status}`)
      console.log(`✓ POST /api/v1/pipeline/${runId}/publish — ${res.status}`)
    } else {
      assert.strictEqual(res.status, 409, `Publish in state ${currentStatus} should return 409, got ${res.status}`)
      console.log(`✓ POST /api/v1/pipeline/${runId}/publish — 409 (state ${currentStatus})`)
    }
  }

  console.log('\nAll E2E tests passed.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
