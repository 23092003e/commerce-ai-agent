import { describe, expect, it } from 'vitest';
import { runGoldenScenario, type AgentTool } from '../src/index.js';

describe('golden evaluator', () => {
  it('passes only when a product scenario uses the expected tool and outcome', async () => {
    const tool: AgentTool = {
      name: 'catalog.searchProducts',
      async execute() {
        return { products: [{ name: 'Essential Polo', priceFrom: 449000 }] };
      }
    };

    await expect(
      runGoldenScenario({
        id: 'product-search',
        input: { customerMessage: 'Tim ao polo' },
        decisions: [
          {
            type: 'tool',
            name: 'catalog.searchProducts',
            input: { query: 'polo' }
          },
          {
            type: 'reply',
            text: 'Em co mau polo phu hop.',
            evidenceChunkIds: []
          }
        ],
        tools: [tool],
        expected: { type: 'reply', toolNames: ['catalog.searchProducts'] }
      })
    ).resolves.toEqual({ id: 'product-search', passed: true, failures: [] });
  });

  it('fails a scenario whose response outcome violates the expected no-evidence handover', async () => {
    const result = await runGoldenScenario({
      id: 'unknown-policy',
      input: { customerMessage: 'Chinh sach khong co trong knowledge?' },
      decisions: [
        { type: 'reply', text: 'Em doan la duoc.', evidenceChunkIds: [] }
      ],
      tools: [],
      expected: { type: 'handover', toolNames: [] }
    });

    expect(result).toEqual({
      id: 'unknown-policy',
      passed: false,
      failures: ['expected outcome handover but received reply']
    });
  });

  it('passes a human-controlled scenario only when the model is suppressed', async () => {
    await expect(
      runGoldenScenario({
        id: 'human-control',
        input: { customerMessage: 'Can tu van', controlMode: 'human' },
        decisions: [
          {
            type: 'reply',
            text: 'This must never be sent.',
            evidenceChunkIds: []
          }
        ],
        tools: [],
        expected: { type: 'suppressed', toolNames: [] }
      })
    ).resolves.toEqual({ id: 'human-control', passed: true, failures: [] });
  });
});
