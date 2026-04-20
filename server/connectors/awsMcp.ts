import { createHash } from 'crypto'
import { config } from '../config'

export interface McpToolResponse {
  status: 'ok' | 'error' | 'unavailable'
  data?: unknown
  error?: string
  fromCache?: boolean
}

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
let concurrentCount = 0

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function cacheKey(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}:${sha256hex(JSON.stringify(input))}`
}

function getCached(key: string): unknown | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.data
}

function setCached(key: string, data: unknown): void {
  const ttlMs = config.mcp.cacheTtlHours * 60 * 60 * 1000
  cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export async function invokeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<McpToolResponse> {
  const inputHash = sha256hex(JSON.stringify(input))
  const key = cacheKey(toolName, input)
  const startMs = Date.now()

  const cached = getCached(key)
  if (cached !== undefined) {
    const latencyMs = Date.now() - startMs
    console.log(JSON.stringify({ event: 'mcp_tool_invoke', tool: toolName, inputHash, status: 'ok', latencyMs, fromCache: true }))
    return { status: 'ok', data: cached, fromCache: true }
  }

  if (concurrentCount >= config.mcp.maxConcurrentQueries) {
    const latencyMs = Date.now() - startMs
    console.log(JSON.stringify({ event: 'mcp_tool_invoke', tool: toolName, inputHash, status: 'error', latencyMs, reason: 'concurrency_limit' }))
    return { status: 'error', error: 'Max concurrent MCP queries reached' }
  }

  if (!config.mcp.serverEndpoint) {
    const latencyMs = Date.now() - startMs
    console.log(JSON.stringify({ event: 'mcp_tool_invoke', tool: toolName, inputHash, status: 'unavailable', latencyMs }))
    return { status: 'unavailable' }
  }

  concurrentCount++

  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.mcp.toolTimeoutSeconds * 1000
  )

  try {
    const response = await fetch(config.mcp.serverEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `ApiKey ${config.mcp.apiKey}`,
      },
      body: JSON.stringify({ tool: toolName, input }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`MCP server responded with status ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastEventName = ''
    let resultData: unknown | undefined

    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          lastEventName = line.slice(6).trim()
        } else if (line.startsWith('data:') && lastEventName === 'result') {
          const raw = line.slice(5).trim()
          try {
            resultData = JSON.parse(raw)
          } catch {
            resultData = raw
          }
          break outer
        }
      }
    }

    reader.cancel().catch(() => undefined)

    if (resultData === undefined) {
      throw new Error('No result event received from MCP server')
    }

    setCached(key, resultData)

    const latencyMs = Date.now() - startMs
    console.log(JSON.stringify({ event: 'mcp_tool_invoke', tool: toolName, inputHash, status: 'ok', latencyMs }))

    return { status: 'ok', data: resultData }
  } catch (err) {
    const isUnavailable =
      err instanceof Error &&
      (err.name === 'AbortError' ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('fetch failed'))

    const staleCached = getCached(key)

    if (isUnavailable) {
      const latencyMs = Date.now() - startMs
      console.log(JSON.stringify({ event: 'mcp_tool_invoke', tool: toolName, inputHash, status: 'unavailable', latencyMs }))
      if (staleCached !== undefined) {
        return { status: 'ok', data: staleCached, fromCache: true }
      }
      return { status: 'unavailable' }
    }

    const detail = err instanceof Error ? err.message : String(err)
    const latencyMs = Date.now() - startMs
    console.log(JSON.stringify({ event: 'mcp_tool_invoke', tool: toolName, inputHash, status: 'error', latencyMs }))
    return { status: 'error', error: detail }
  } finally {
    clearTimeout(timeoutId)
    concurrentCount--
  }
}
