import { describe, expect, it } from 'vitest';
import { createOpenAiDecisionProvider } from '../src/index.js';
describe('OpenAI decision provider', () => {
  it('classifies an output exhausted by reasoning without retaining reasoning content', async () => {
    const provider = createOpenAiDecisionProvider({
      apiKey: 'key',
      model: 'test',
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [
              {
                type: 'reasoning',
                content: [{ type: 'reasoning_text', text: 'private text' }]
              }
            ]
          };
        }
      })
    });
    const context = {
      customerMessage: 'test',
      controlMode: 'ai' as const,
      productReferences: [],
      recentMessages: [],
      cart: null,
      checkout: null
    };
    try {
      await provider.decide({ context, toolResults: [] });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'output_limit' });
      expect(JSON.stringify(error)).not.toContain('private text');
    }
  });
  it('reports a timeout when reading the response body is aborted', async () => {
    const provider = createOpenAiDecisionProvider({
      apiKey: 'key',
      model: 'test',
      timeoutMs: 10,
      fetch: async (_url, request) => ({
        ok: true,
        status: 200,
        async json() {
          await new Promise<void>((_resolve, reject) => {
            request.signal?.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true }
            );
          });
          return {};
        }
      })
    });
    const context = {
      customerMessage: 'test',
      controlMode: 'ai' as const,
      productReferences: [],
      recentMessages: [],
      cart: null,
      checkout: null
    };
    await expect(
      provider.decide({ context, toolResults: [] })
    ).rejects.toMatchObject({ code: 'timeout' });
  });
  it('classifies invalid response content without retaining it', async () => {
    const provider = createOpenAiDecisionProvider({
      apiKey: 'key',
      model: 'test',
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            output: [
              {
                content: [{ type: 'output_text', text: 'private invalid json' }]
              }
            ]
          };
        }
      })
    });
    const context = {
      customerMessage: 'test',
      controlMode: 'ai' as const,
      productReferences: [],
      recentMessages: [],
      cart: null,
      checkout: null
    };
    await expect(
      provider.decide({ context, toolResults: [] })
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('classifies provider HTTP failure without including response content or credentials', async () => {
    const provider = createOpenAiDecisionProvider({
      apiKey: 'private-key',
      model: 'test',
      fetch: async () => ({
        ok: false,
        status: 429,
        async json() {
          return { secret: 'private-body' };
        }
      })
    });
    const context = {
      customerMessage: 'test',
      controlMode: 'ai' as const,
      productReferences: [],
      recentMessages: [],
      cart: null,
      checkout: null
    };
    try {
      await provider.decide({ context, toolResults: [] });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'http_429' });
      expect(JSON.stringify(error)).not.toContain('private');
    }
  });
  it('does not send OpenRouter reasoning settings to OpenAI', async () => {
    let body: unknown;
    const provider = createOpenAiDecisionProvider({
      apiKey: 'test-key',
      model: 'test-model',
      fetch: async (_url, request) => {
        if (typeof request.body !== 'string')
          throw new Error('Expected JSON request body');
        body = JSON.parse(request.body);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              output: [
                {
                  content: [
                    {
                      type: 'output_text',
                      text: '{"type":"handover","reason":"needs_staff"}'
                    }
                  ]
                }
              ]
            };
          }
        };
      }
    });
    await provider.decide({
      context: {
        customerMessage: 'help',
        controlMode: 'ai',
        productReferences: [],
        recentMessages: [],
        cart: null,
        checkout: null
      },
      toolResults: []
    });
    expect(body).not.toHaveProperty('reasoning.enabled');
  });
  it('extracts a structured decision without exposing the key', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    const provider = createOpenAiDecisionProvider({
      apiKey: 'secret',
      model: 'test',
      baseUrl: 'https://openrouter.ai/api/v1/',
      fetch: async (url, request) => {
        requestUrl = url;
        if (typeof request.body !== 'string') {
          throw new Error('Expected JSON string request body');
        }
        requestBody = JSON.parse(request.body);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              output: [
                {
                  content: [
                    {
                      type: 'output_text',
                      text: '{"type":"handover","reason":"needs_staff"}'
                    }
                  ]
                }
              ]
            };
          }
        };
      }
    });
    await expect(
      provider.decide({
        context: {
          customerMessage: 'help',
          controlMode: 'ai',
          productReferences: [],
          recentMessages: [],
          cart: null,
          checkout: null
        },
        toolResults: []
      })
    ).resolves.toEqual({ type: 'handover', reason: 'needs_staff' });
    expect(requestUrl).toBe('https://openrouter.ai/api/v1/responses');
    expect(requestBody).toMatchObject({
      temperature: 0.2,
      max_output_tokens: 1_000,
      text: { format: { type: 'json_schema', strict: true } }
    });
    expect(requestBody).not.toHaveProperty('reasoning.enabled', false);
    expect(JSON.stringify(requestBody)).toContain('catalog.searchProducts');
  });
});
