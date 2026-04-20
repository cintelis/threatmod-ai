import { AzureOpenAI } from 'openai'
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity'
import { config } from '../config'
import type { LLMMessage, LLMOptions, LLMResponse, LLMProvider } from './types'

const apiVersion = '2024-12-01-preview'
const { endpoint, apiKey, deployment } = config.azureOpenAI

const client: AzureOpenAI = apiKey
  ? new AzureOpenAI({ apiKey, endpoint, apiVersion, deployment })
  : new AzureOpenAI({
      azureADTokenProvider: getBearerTokenProvider(
        new DefaultAzureCredential(),
        'https://cognitiveservices.azure.com/.default',
      ),
      endpoint,
      apiVersion,
      deployment,
    })

export class AzureOpenAIProvider implements LLMProvider {
  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const maxTokens = options?.maxTokens ?? 4096
    const start = Date.now()

    const response = await client.chat.completions.create({
      model: deployment,
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })

    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    const latency = Date.now() - start

    console.log(
      `[azure-openai] deployment=${deployment} in=${inputTokens} out=${outputTokens} latency=${latency}ms`,
    )

    const content = response.choices[0]?.message?.content ?? ''

    return { content, inputTokens, outputTokens }
  }
}
