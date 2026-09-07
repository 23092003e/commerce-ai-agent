import { describe, expect, it } from 'vitest';
import { createOpenAiDecisionProvider } from '../src/index.js';
describe('OpenAI decision provider', () => {
  it('extracts a structured decision without exposing the key', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    const provider = createOpenAiDecisionProvider({
      apiKey: 'secret',
      model: 'test',
      baseUrl: 'https://openrouter.ai/api/v1/',
      fetch: async (url, request) => {
        requestUrl = url;
        requestBody = JSON.parse(String(request.body));
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
          productReferences: []
        },
        toolResults: []
      })
    ).resolves.toEqual({ type: 'handover', reason: 'needs_staff' });
    expect(requestUrl).toBe('https://openrouter.ai/api/v1/responses');
    expect(requestBody).toMatchObject({
      text: { format: { type: 'json_schema', strict: true } }
    });
  });
});
