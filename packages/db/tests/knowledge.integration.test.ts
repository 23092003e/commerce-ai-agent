import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createDeterministicEmbeddingProvider,
  createKnowledgeService,
  type EmbeddingProvider
} from '@fanpage/domain';
import { PostgresKnowledgeRepository, runMigrations } from '../src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresKnowledgeRepository(databaseUrl);
const service = createKnowledgeService(
  repository,
  createDeterministicEmbeddingProvider(8)
);

beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => repository.close());

describe('Postgres knowledge RAG', () => {
  it('retrieves known shipping and returns FAQ evidence and keeps unknown policy grounded', async () => {
    const knownCases = [
      {
        query: 'shipping orders arrive',
        topics: ['shipping'],
        evidence: 'shipping policy'
      },
      {
        query: 'unused items returned',
        topics: ['returns'],
        evidence: 'returns policy'
      }
    ];
    for (const knownCase of knownCases) {
      const result = await service.search({
        query: knownCase.query,
        topics: knownCase.topics
      });
      expect(result.type).toBe('evidence');
      if (result.type !== 'evidence')
        throw new Error('Expected policy evidence');
      const firstChunk = result.chunks[0];
      if (!firstChunk) throw new Error('Expected policy chunk');
      expect(firstChunk.content).toContain(knownCase.evidence);
      expect(firstChunk.documentId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(firstChunk.chunkId).toMatch(/^[0-9a-f-]{36}$/u);
    }
    await expect(
      service.search({ query: 'astronaut insurance policy' })
    ).resolves.toEqual({ type: 'insufficient_evidence', chunks: [] });
  });

  it('deduplicates same normalized approved document by content hash', async () => {
    const suffix = randomUUID();
    const input = {
      title: `Temporary FAQ ${suffix}`,
      sourceType: 'faq' as const,
      topics: ['temporary'],
      content: `# Delivery\n\nTemporary delivery information ${suffix}.`
    };
    const first = await service.ingest(input);
    const second = await service.ingest({
      ...input,
      content: `# Delivery\r\n\r\nTemporary delivery information ${suffix}.  `
    });
    expect(first.type).toBe('created');
    expect(second).toEqual({ type: 'duplicate', documentId: first.documentId });
    const updated = await service.ingest({
      ...input,
      content: `# Delivery\n\nUpdated delivery information ${suffix}.`
    });
    expect(updated.type).toBe('created');
    expect(updated.documentId).not.toBe(first.documentId);
  });

  it('keeps semantic retrieval available when another active document uses a different embedding dimension', async () => {
    const otherDimensions = createKnowledgeService(
      repository,
      createDeterministicEmbeddingProvider(16)
    );
    await otherDimensions.ingest({
      title: `Alternative model ${randomUUID()}`,
      sourceType: 'faq',
      topics: ['alternate'],
      content: '# Alternate\n\nThis document uses a different embedding model.'
    });
    await expect(
      service.search({ query: 'shipping orders arrive', topics: ['shipping'] })
    ).resolves.toMatchObject({ type: 'evidence' });
  });

  it('retrieves semantic-only evidence when FTS has no lexical match', async () => {
    const semanticProvider: EmbeddingProvider = {
      dimensions: 8,
      async embed(text) {
        return text.includes('semantic-anchor') || text.includes('paraphrase')
          ? [1, 0, 0, 0, 0, 0, 0, 0]
          : [0, 1, 0, 0, 0, 0, 0, 0];
      }
    };
    const semanticService = createKnowledgeService(
      repository,
      semanticProvider
    );
    const marker = randomUUID();
    await semanticService.ingest({
      title: `Semantic evidence ${marker}`,
      sourceType: 'faq',
      topics: ['semantic-test'],
      content: `# Semantic\n\nsemantic-anchor-${marker}`
    });
    const result = await semanticService.search({
      query: 'paraphrase intent without matching words',
      topics: ['semantic-test']
    });
    expect(result.type).toBe('evidence');
    if (result.type !== 'evidence')
      throw new Error('Expected semantic evidence');
    expect(result.chunks[0]?.content).toContain('semantic-anchor');
    expect(result.chunks[0]?.keywordRank).toBeUndefined();
    expect(result.chunks[0]?.semanticRank).toBe(1);
  });
});
