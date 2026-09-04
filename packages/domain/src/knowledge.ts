import { createHash } from 'node:crypto';
import { getEncoding } from 'js-tiktoken';
import { z } from 'zod';

const topicSchema = z.array(z.string().trim().min(1).max(100)).max(10);
const identifier = z.uuid();
const tokenizer = getEncoding('cl100k_base');

export const KnowledgeIngestionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    sourceType: z.enum(['policy', 'faq', 'guide', 'script']),
    sourceUri: z.url().max(2_048).optional(),
    sourceKey: z.string().trim().min(1).max(500).optional(),
    content: z.string().trim().min(1).max(100_000),
    topics: topicSchema.default([])
  })
  .strict();
export const KnowledgeSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    topics: topicSchema.optional(),
    topK: z.number().int().min(1).max(10).default(6)
  })
  .strict();

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
export interface PreparedKnowledgeChunk {
  title: string;
  content: string;
  section: string | null;
  tokenCount: number;
  embedding: number[];
}
export interface PreparedKnowledgeDocument {
  sourceKey: string;
  embeddingDimensions: number;
  title: string;
  sourceType: 'policy' | 'faq' | 'guide' | 'script';
  sourceUri?: string;
  contentHash: string;
  topics: string[];
  chunks: PreparedKnowledgeChunk[];
}
export interface KnowledgeSearchHit {
  chunkId: string;
  documentId: string;
  content: string;
  section: string | null;
  keywordRank?: number;
  semanticRank?: number;
}
export interface KnowledgeRepository {
  ingest(
    document: PreparedKnowledgeDocument
  ): Promise<
    | { type: 'created'; documentId: string }
    | { type: 'duplicate'; documentId: string }
  >;
  searchKeyword(input: {
    query: string;
    topics?: string[];
    topK: number;
  }): Promise<KnowledgeSearchHit[]>;
  searchSemantic(input: {
    embedding: number[];
    topics?: string[];
    topK: number;
  }): Promise<KnowledgeSearchHit[]>;
}
export type KnowledgeSearchResult =
  | { type: 'insufficient_evidence'; chunks: [] }
  | {
      type: 'evidence';
      chunks: Array<KnowledgeSearchHit & { combinedScore: number }>;
    };
export interface KnowledgeService {
  ingest(
    input: unknown
  ): Promise<
    | { type: 'created'; documentId: string }
    | { type: 'duplicate'; documentId: string }
  >;
  search(input: unknown): Promise<KnowledgeSearchResult>;
}

function words(content: string): string[] {
  return content.trim().split(/\s+/u).filter(Boolean);
}
function normalized(content: string): string {
  return content
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}
function chunk(
  content: string
): Array<Omit<PreparedKnowledgeChunk, 'embedding' | 'title'>> {
  const sections: Array<{ section: string | null; tokens: number[] }> = [];
  let section: string | null = null;
  let sectionTokens: string[] = [];
  const flushSection = () => {
    if (sectionTokens.length > 0) {
      sections.push({
        section,
        tokens: tokenizer.encode(sectionTokens.join(' '))
      });
    }
    sectionTokens = [];
  };
  const headings: Array<{ level: number; title: string }> = [];
  for (const line of content.split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line.trim());
    if (heading) {
      flushSection();
      const level = heading[1]?.length ?? 1;
      const title = heading[2]?.trim() ?? '';
      while ((headings.at(-1)?.level ?? 0) >= level) headings.pop();
      headings.push({ level, title });
      section = headings.map((item) => item.title).join(' > ');
    } else if (line.trim()) sectionTokens.push(...words(line));
  }
  flushSection();
  const entries = sections.flatMap((item) =>
    item.tokens.map((token) => ({ token, section: item.section }))
  );
  const chunks: Array<Omit<PreparedKnowledgeChunk, 'embedding' | 'title'>> = [];
  let index = 0;
  while (index < entries.length) {
    const remaining = entries.length - index;
    const size = remaining <= 800 ? remaining : 500;
    const slice = entries.slice(index, index + size);
    const paths = [
      ...new Set(slice.map((item) => item.section).filter(Boolean))
    ];
    chunks.push({
      content: tokenizer.decode(slice.map((item) => item.token)),
      section: paths.length ? paths.join(' | ') : null,
      tokenCount: slice.length
    });
    if (index + size === entries.length) break;
    const after = entries.length - (index + size);
    index = after < 400 ? entries.length - 400 : index + size - 50;
  }
  return chunks;
}

export function createDeterministicEmbeddingProvider(
  dimensions: number
): EmbeddingProvider {
  if (!Number.isInteger(dimensions) || dimensions < 2 || dimensions > 4_096)
    throw new Error('Embedding dimensions must be an integer from 2 to 4096');
  return {
    dimensions,
    async embed(text) {
      const vector = Array<number>(dimensions).fill(0);
      for (const token of words(text.toLocaleLowerCase('en-US'))) {
        const hash = createHash('sha256').update(token).digest();
        const index = hash.readUInt16BE(0) % dimensions;
        vector[index] =
          (vector[index] ?? 0) + ((hash[2] ?? 0) % 2 === 0 ? 1 : -1);
      }
      const magnitude = Math.hypot(...vector);
      return magnitude === 0
        ? vector
        : vector.map((value) => value / magnitude);
    }
  };
}

function checked(hit: KnowledgeSearchHit): KnowledgeSearchHit {
  const ranks = {
    ...(hit.keywordRank === undefined
      ? {}
      : { keywordRank: z.number().int().positive().parse(hit.keywordRank) }),
    ...(hit.semanticRank === undefined
      ? {}
      : { semanticRank: z.number().int().positive().parse(hit.semanticRank) })
  };
  return {
    chunkId: identifier.parse(hit.chunkId),
    documentId: identifier.parse(hit.documentId),
    content: z.string().min(1).max(4_000).parse(hit.content),
    section: z.string().min(1).max(500).nullable().parse(hit.section),
    ...ranks
  };
}

export function createKnowledgeService(
  repository: KnowledgeRepository,
  embeddings: EmbeddingProvider
): KnowledgeService {
  const embed = async (text: string): Promise<number[]> => {
    const value = await embeddings.embed(text);
    if (
      value.length !== embeddings.dimensions ||
      !value.every((entry) => Number.isFinite(entry))
    ) {
      throw new Error('Embedding provider returned an invalid vector');
    }
    return value;
  };
  return {
    async ingest(input) {
      const parsed = KnowledgeIngestionSchema.parse(input);
      const content = normalized(parsed.content);
      const chunks = await Promise.all(
        chunk(content).map(async (item) => ({
          ...item,
          title: parsed.title,
          embedding: await embed(
            [parsed.title, item.section, item.content]
              .filter(Boolean)
              .join('\n')
          )
        }))
      );
      if (!chunks.length) throw new Error('Knowledge content has no chunks');
      return repository.ingest({
        sourceKey: parsed.sourceKey ?? parsed.sourceUri ?? parsed.title,
        embeddingDimensions: embeddings.dimensions,
        title: parsed.title,
        sourceType: parsed.sourceType,
        ...(parsed.sourceUri === undefined
          ? {}
          : { sourceUri: parsed.sourceUri }),
        topics: parsed.topics,
        contentHash: createHash('sha256').update(content).digest('hex'),
        chunks
      });
    },
    async search(input) {
      const parsed = KnowledgeSearchSchema.parse(input);
      const embedding = await embed(parsed.query);
      const searchInput = {
        query: parsed.query,
        topK: parsed.topK,
        ...(parsed.topics === undefined ? {} : { topics: parsed.topics })
      };
      const [keyword, semantic] = await Promise.all([
        repository.searchKeyword(searchInput),
        repository.searchSemantic({ ...searchInput, embedding })
      ]);
      const merged = new Map<string, KnowledgeSearchHit>();
      for (const hit of [...keyword, ...semantic]) {
        const valid = checked(hit);
        const existing = merged.get(valid.chunkId);
        const ranks = {
          ...((valid.keywordRank ?? existing?.keywordRank) === undefined
            ? {}
            : { keywordRank: valid.keywordRank ?? existing?.keywordRank }),
          ...((valid.semanticRank ?? existing?.semanticRank) === undefined
            ? {}
            : { semanticRank: valid.semanticRank ?? existing?.semanticRank })
        };
        const mergedHit: KnowledgeSearchHit = {
          chunkId: valid.chunkId,
          documentId: valid.documentId,
          content: valid.content,
          section: valid.section
        };
        if (ranks.keywordRank !== undefined)
          mergedHit.keywordRank = ranks.keywordRank;
        if (ranks.semanticRank !== undefined)
          mergedHit.semanticRank = ranks.semanticRank;
        merged.set(valid.chunkId, mergedHit);
      }
      const chunks = [...merged.values()]
        .map((hit) => ({
          ...hit,
          combinedScore:
            (hit.keywordRank ? 1 / (60 + hit.keywordRank) : 0) +
            (hit.semanticRank ? 1 / (60 + hit.semanticRank) : 0)
        }))
        .sort((left, right) => right.combinedScore - left.combinedScore)
        .slice(0, parsed.topK);
      return chunks.length
        ? { type: 'evidence', chunks }
        : { type: 'insufficient_evidence', chunks: [] };
    }
  };
}
