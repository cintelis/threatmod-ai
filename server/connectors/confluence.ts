import { config } from '../config'

export interface ConfluencePage {
  id: string
  version: number
  url: string
}

function authHeader(): string {
  const encoded = Buffer.from(`${config.confluence.email}:${config.confluence.apiToken}`).toString('base64')
  return `Basic ${encoded}`
}

async function confluenceRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${config.confluence.baseUrl}${path}`
  const start = Date.now()

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  const latencyMs = Date.now() - start
  console.log(JSON.stringify({ event: 'confluence_api', method, url, status: response.status, latencyMs }))

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Confluence API error ${response.status} ${method} ${url}: ${text}`)
  }

  return response.json() as Promise<T>
}

interface ConfluencePageResponse {
  id: string
  version: { number: number }
  _links: { webui: string; base?: string }
}

interface ConfluencePagesListResponse {
  results: ConfluencePageResponse[]
}

function mapPage(data: ConfluencePageResponse, baseUrl: string): ConfluencePage {
  const webui = data._links.webui
  const base = data._links.base ?? baseUrl
  const url = webui.startsWith('http') ? webui : `${base}${webui}`
  return {
    id: data.id,
    version: data.version.number,
    url,
  }
}

export async function getPage(spaceKey: string, title: string): Promise<ConfluencePage | null> {
  const params = new URLSearchParams({ spaceKey, title, limit: '1' })
  const data = await confluenceRequest<ConfluencePagesListResponse>(
    'GET',
    `/wiki/api/v2/pages?${params.toString()}`
  )

  if (!data.results || data.results.length === 0) return null
  return mapPage(data.results[0], config.confluence.baseUrl)
}

export async function createPage(
  spaceKey: string,
  parentId: string | null,
  title: string,
  xhtmlContent: string
): Promise<ConfluencePage> {
  const body: Record<string, unknown> = {
    spaceId: spaceKey,
    title,
    body: { representation: 'storage', value: xhtmlContent },
    status: 'current',
  }
  if (parentId) body.parentId = parentId

  const data = await confluenceRequest<ConfluencePageResponse>('POST', '/wiki/api/v2/pages', body)
  return mapPage(data, config.confluence.baseUrl)
}

export async function updatePage(
  pageId: string,
  version: number,
  title: string,
  xhtmlContent: string
): Promise<ConfluencePage> {
  const body = {
    id: pageId,
    version: { number: version + 1 },
    title,
    body: { representation: 'storage', value: xhtmlContent },
    status: 'current',
  }

  const data = await confluenceRequest<ConfluencePageResponse>('PUT', `/wiki/api/v2/pages/${pageId}`, body)
  return mapPage(data, config.confluence.baseUrl)
}

export async function upsertPage(
  spaceKey: string,
  parentId: string | null,
  title: string,
  xhtmlContent: string
): Promise<ConfluencePage> {
  const existing = await getPage(spaceKey, title)
  if (existing) {
    return updatePage(existing.id, existing.version, title, xhtmlContent)
  }
  return createPage(spaceKey, parentId, title, xhtmlContent)
}

export async function ensurePageHierarchy(projectName: string): Promise<string> {
  const spaceKey = config.confluence.spaceId
  const configuredParentId = config.confluence.parentPageId || null

  const placeholder = '<body><p>Threat Models</p></body>'

  const threatModelsPage = await upsertPage(spaceKey, configuredParentId, 'Threat Models', placeholder)

  const projectPage = await upsertPage(
    spaceKey,
    threatModelsPage.id,
    projectName,
    '<body><p>Threat model documentation for this project.</p></body>'
  )

  return projectPage.id
}
