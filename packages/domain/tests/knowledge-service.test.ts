import { describe, expect, it } from 'vitest';
import {
  createDeterministicEmbeddingProvider,
  createKnowledgeService,
  type KnowledgeRepository,
  type PreparedKnowledgeDocument
} from '../src/index.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const chunkId = '22222222-2222-4222-8222-222222222222';
const semanticOnlyChunkId = '33333333-3333-4333-8333-333333333333';
const sharedChunkId = '44444444-4444-4444-8444-444444444444';

describe('knowledge service', () => {
  it('ingests normalized approved knowledge once and preserves heading metadata', async () => {
    const calls: PreparedKnowledgeDocument[] = [];
    const repository: KnowledgeRepository = {
      async ingest(document) {
        calls.push(document);
        return { type: 'created', documentId };
      },
      async searchKeyword() {
        return [];
      },
      async searchSemantic() {
        return [];
      }
    };
    const service = createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(8)
    );

    await expect(
      service.ingest({
        title: 'Shipping policy',
        sourceType: 'policy',
        content: '# Domestic shipping\n\nOrders arrive in 2 business days.',
        topics: ['shipping']
      })
    ).resolves.toEqual({ type: 'created', documentId });

    expect(calls).toHaveLength(1);
    const document = calls[0];
    if (!document) throw new Error('Expected ingested document');
    expect(document.title).toBe('Shipping policy');
    expect(document.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    const firstChunk = document.chunks[0];
    if (!firstChunk) throw new Error('Expected knowledge chunk');
    expect(firstChunk.content).toBe('Orders arrive in 2 business days.');
    expect(firstChunk.section).toBe('Domestic shipping');
    expect(firstChunk.tokenCount).toBe(8);
    expect(firstChunk.embedding.every(Number.isFinite)).toBe(true);
  });

  it('fuses keyword and semantic evidence and reports insufficient evidence', async () => {
    const repository: KnowledgeRepository = {
      async ingest() {
        return { type: 'duplicate', documentId };
      },
      async searchKeyword() {
        return [
          {
            chunkId,
            documentId,
            content: 'Returns are accepted within 7 days for unused items.',
            section: 'Returns',
            keywordRank: 1
          }
        ];
      },
      async searchSemantic() {
        return [
          {
            chunkId,
            documentId,
            content: 'Returns are accepted within 7 days for unused items.',
            section: 'Returns',
            semanticRank: 1
          }
        ];
      }
    };
    const service = createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(8)
    );

    await expect(service.search({ query: 'return policy' })).resolves.toEqual({
      type: 'evidence',
      chunks: [
        {
          chunkId,
          documentId,
          content: 'Returns are accepted within 7 days for unused items.',
          section: 'Returns',
          keywordRank: 1,
          semanticRank: 1,
          combinedScore: 0.03278688524590164
        }
      ]
    });

    const emptyService = createKnowledgeService(
      {
        ...repository,
        async searchKeyword() {
          return [];
        },
        async searchSemantic() {
          return [];
        }
      },
      createDeterministicEmbeddingProvider(8)
    );
    await expect(
      emptyService.search({ query: 'refund cash' })
    ).resolves.toEqual({
      type: 'insufficient_evidence',
      chunks: []
    });
  });

  it('chunks a long section into bounded overlapping semantic context', async () => {
    const captured: PreparedKnowledgeDocument[] = [];
    const repository: KnowledgeRepository = {
      async ingest(document) {
        captured.push(document);
        return { type: 'created', documentId };
      },
      async searchKeyword() {
        return [];
      },
      async searchSemantic() {
        return [];
      }
    };
    const words = Array.from(
      { length: 900 },
      (_, index) => `word${String(index + 1)}`
    );
    const service = createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(8)
    );

    await service.ingest({
      title: 'Long guide',
      sourceType: 'guide',
      content: `# Care\n\n${words.slice(0, 450).join(' ')}\n\n${words.slice(450).join(' ')}`
    });

    const chunks = captured[0]?.chunks;
    expect(
      chunks?.every((item) => item.tokenCount >= 400 && item.tokenCount <= 800)
    ).toBe(true);
    expect(chunks?.[0]?.section).toBe('Care');
  });

  it('returns semantic-only evidence and ranks dual-branch RRF evidence first', async () => {
    const repository: KnowledgeRepository = {
      async ingest() {
        return { type: 'duplicate', documentId };
      },
      async searchKeyword() {
        return [
          {
            chunkId,
            documentId,
            content: 'Exact keyword match.',
            section: null,
            keywordRank: 1
          },
          {
            chunkId: sharedChunkId,
            documentId,
            content: 'Dual branch match.',
            section: null,
            keywordRank: 2
          }
        ];
      },
      async searchSemantic() {
        return [
          {
            chunkId: semanticOnlyChunkId,
            documentId,
            content: 'Meaning-only evidence.',
            section: null,
            semanticRank: 1
          },
          {
            chunkId: sharedChunkId,
            documentId,
            content: 'Dual branch match.',
            section: null,
            semanticRank: 2
          }
        ];
      }
    };
    const result = await createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(8)
    ).search({ query: 'non lexical intent' });
    expect(result.type).toBe('evidence');
    if (result.type !== 'evidence') throw new Error('Expected RRF evidence');
    expect(result.chunks[0]?.chunkId).toBe(sharedChunkId);
    expect(
      result.chunks.some((item) => item.chunkId === semanticOnlyChunkId)
    ).toBe(true);
  });

  it('preserves nested section paths and avoids short tails in long documents', async () => {
    const captured: PreparedKnowledgeDocument[] = [];
    const repository: KnowledgeRepository = {
      async ingest(document) {
        captured.push(document);
        return { type: 'created', documentId };
      },
      async searchKeyword() {
        return [];
      },
      async searchSemantic() {
        return [];
      }
    };
    const content = Array.from(
      { length: 1_001 },
      (_, index) => `token${String(index + 1)}`
    ).join(' ');
    await createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(8)
    ).ingest({
      title: 'Nested guide',
      sourceType: 'guide',
      content: `# Returns\n## Eligibility\n### Condition\n${content}`
    });

    const chunks = captured[0]?.chunks ?? [];
    expect(
      chunks.every((item) => item.tokenCount >= 400 && item.tokenCount <= 800)
    ).toBe(true);
    expect(chunks[0]?.section).toBe('Returns > Eligibility > Condition');
  });

  it('packs a long document made of short sections without undersized fragments', async () => {
    const captured: PreparedKnowledgeDocument[] = [];
    const repository: KnowledgeRepository = {
      async ingest(document) {
        captured.push(document);
        return { type: 'created', documentId };
      },
      async searchKeyword() {
        return [];
      },
      async searchSemantic() {
        return [];
      }
    };
    const section = (name: string, start: number) =>
      `# ${name}\n${Array.from({ length: 300 }, (_, index) => `w${String(start + index)}`).join(' ')}`;
    await createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(8)
    ).ingest({
      title: 'Packed',
      sourceType: 'guide',
      content: [
        section('One', 0),
        section('Two', 300),
        section('Three', 600)
      ].join('\n\n')
    });
    const chunks = captured[0]?.chunks ?? [];
    expect(
      chunks.every((item) => item.tokenCount >= 400 && item.tokenCount <= 800)
    ).toBe(true);
    expect(chunks[0]?.section).toContain('One');
    expect(chunks.some((item) => item.section?.includes('Two'))).toBe(true);
  });
});
