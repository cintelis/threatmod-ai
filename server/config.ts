export const config = {
  port: Number(process.env.PORT) || 3000,
  llmProvider: (process.env.LLM_PROVIDER || 'anthropic') as 'anthropic' | 'azure-openai',
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },
  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',
    folder: process.env.GITHUB_FOLDER || 'architectures',
    outputFolder: process.env.GITHUB_OUTPUT_FOLDER || 'threat-models',
  },
  powerAutomate: {
    webhookUrl: process.env.POWER_AUTOMATE_WEBHOOK_URL || '',
    secondaryApproverEmail: process.env.SECONDARY_APPROVER_EMAIL || '',
  },
  mcp: {
    serverEndpoint: process.env.MCP_SERVER_ENDPOINT || '',
    authMethod: process.env.MCP_AUTH_METHOD || 'api-key',
    apiKey: process.env.MCP_API_KEY || '',
    toolTimeoutSeconds: Number(process.env.TOOL_TIMEOUT_SECONDS) || 30,
    maxConcurrentQueries: Number(process.env.MAX_CONCURRENT_QUERIES) || 5,
    verificationDepth: (process.env.VERIFICATION_DEPTH || 'STANDARD') as 'BASIC' | 'STANDARD' | 'DEEP',
    cacheTtlHours: Number(process.env.CACHE_TTL_HOURS) || 24,
  },
  confluence: {
    baseUrl: process.env.CONFLUENCE_BASE_URL || '',
    email: process.env.CONFLUENCE_EMAIL || '',
    apiToken: process.env.CONFLUENCE_API_TOKEN || '',
    spaceId: process.env.CONFLUENCE_SPACE_ID || '',
    parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID || '',
  },
  pipeline: {
    concurrency: Number(process.env.PIPELINE_CONCURRENCY) || 3,
    approvalTimeoutHours: Number(process.env.APPROVAL_TIMEOUT_HOURS) || 72,
    approverEmail: process.env.APPROVER_EMAIL || '',
    apiKey: process.env.PIPELINE_API_KEY || '',
  },
  serverBaseUrl: process.env.SERVER_BASE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
}
