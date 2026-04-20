import { config } from '../config'
import { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { AzureOpenAIProvider } from './azureOpenAI'

export { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types'

export function createProvider(): LLMProvider {
  return config.llmProvider === 'azure-openai'
    ? new AzureOpenAIProvider()
    : new AnthropicProvider()
}
