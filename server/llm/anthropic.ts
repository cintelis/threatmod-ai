import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config'
import type { LLMMessage, LLMOptions, LLMResponse, LLMProvider } from './types'

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

export class AnthropicProvider implements LLMProvider {
  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = config.anthropic.model
    const maxTokens = options?.maxTokens ?? 4096
    const start = Date.now()

    const systemMessage = messages[0]?.role === 'system' ? messages[0] : null
    const userMessages = systemMessage ? messages.slice(1) : messages

    const systemParam: Anthropic.Beta.Messages.BetaTextBlockParam[] | string | undefined =
      systemMessage
        ? options?.cacheSystemPrompt
          ? [{ type: 'text', text: systemMessage.content, cache_control: { type: 'ephemeral' } }]
          : systemMessage.content
        : undefined

    const betaMessages: Anthropic.Beta.Messages.BetaMessageParam[] = userMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const response = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      ...(systemParam !== undefined ? { system: systemParam } : {}),
      messages: betaMessages,
      betas: ['prompt-caching-2024-07-31'],
    })

    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cachedTokens = response.usage.cache_read_input_tokens ?? 0
    const latency = Date.now() - start

    console.log(
      `[anthropic] model=${model} in=${inputTokens} out=${outputTokens} cached=${cachedTokens} latency=${latency}ms`,
    )

    const content = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    return { content, inputTokens, outputTokens, cachedTokens }
  }
}
