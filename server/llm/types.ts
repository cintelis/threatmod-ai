export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMOptions {
  maxTokens?: number
  temperature?: number
  cacheSystemPrompt?: boolean
}

export interface LLMResponse {
  content: string
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>
}
