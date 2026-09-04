import type {
  KnowledgeRepository,
  KnowledgeSearchHit,
  PreparedKnowledgeDocument
} from '@fanpage/domain';
import { Pool } from 'pg';

interface KnowledgeRow {
  chunk_id: string;
  document_id: string;
  content: string;
  section: string | null;
}

function vector(values: number[]): string {
  return `[${values.join(',')}]`;
}

function toHit(
  row: KnowledgeRow,
  rank: number,
  kind: 'keyword' | 'semantic'
): KnowledgeSearchHit {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    section: row.section,
    ...(kind === 'keyword' ? { keywordRank: rank } : { semanticRank: rank })
  };
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async ingest(
    document: PreparedKnowledgeDocument
  ): Promise<
    | { type: 'created'; documentId: string }
    | { type: 'duplicate'; documentId: string }
  > {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        document.sourceKey
      ]);
      const nextVersion = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM knowledge_documents WHERE source_key = $1`,
        [document.sourceKey]
      );
      const version = nextVersion.rows[0]?.version;
      if (!version)
        throw new Error('Knowledge document version was not created');
      const created = await client.query<{ id: string }>(
        `INSERT INTO knowledge_documents (source_key, title, source_type, source_uri, content_hash, topics, embedding_dimensions, version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
        [
          document.sourceKey,
          document.title,
          document.sourceType,
          document.sourceUri ?? null,
          document.contentHash,
          document.topics,
          document.embeddingDimensions,
          version
        ]
      );
      const documentId = created.rows[0]?.id;
      if (!documentId) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM knowledge_documents WHERE content_hash = $1',
          [document.contentHash]
        );
        const existingDocumentId = existing.rows[0]?.id;
        if (!existingDocumentId)
          throw new Error('Knowledge document conflict did not return an id');
        await client.query('COMMIT');
        return { type: 'duplicate', documentId: existingDocumentId };
      }
      await client.query(
        `UPDATE knowledge_documents SET status = 'archived', updated_at = now()
         WHERE source_key = $1 AND id <> $2 AND status = 'active'`,
        [document.sourceKey, documentId]
      );
      for (const [index, chunk] of document.chunks.entries()) {
        await client.query(
          `INSERT INTO knowledge_chunks (document_id, chunk_index, content, token_count, section, embedding, metadata) VALUES ($1, $2, $3, $4, $5::text, $6::vector, jsonb_build_object('title', $7::text, 'section_path', $5::text))`,
          [
            documentId,
            index,
            chunk.content,
            chunk.tokenCount,
            chunk.section,
            vector(chunk.embedding),
            chunk.title
          ]
        );
      }
      await client.query('COMMIT');
      return { type: 'created', documentId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async searchKeyword(input: {
    query: string;
    topics?: string[];
    topK: number;
  }): Promise<KnowledgeSearchHit[]> {
    const result = await this.pool.query<KnowledgeRow>(
      `SELECT c.id AS chunk_id, c.document_id, c.content, c.section FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.status = 'active' AND c.fts @@ plainto_tsquery('simple', $1) AND ($2::text[] IS NULL OR d.topics && $2::text[]) ORDER BY ts_rank_cd(c.fts, plainto_tsquery('simple', $1)) DESC, c.id LIMIT $3`,
      [input.query, input.topics ?? null, input.topK]
    );
    return result.rows.map((row, index) => toHit(row, index + 1, 'keyword'));
  }

  async searchSemantic(input: {
    embedding: number[];
    topics?: string[];
    topK: number;
  }): Promise<KnowledgeSearchHit[]> {
    const result = await this.pool.query<KnowledgeRow>(
      `SELECT c.id AS chunk_id, c.document_id, c.content, c.section FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.status = 'active' AND d.embedding_dimensions = $4 AND ($2::text[] IS NULL OR d.topics && $2::text[]) AND CASE WHEN vector_dims(c.embedding) = $4 THEN c.embedding <=> $1::vector ELSE NULL END < 0.7 ORDER BY CASE WHEN vector_dims(c.embedding) = $4 THEN c.embedding <=> $1::vector ELSE NULL END, c.id LIMIT $3`,
      [
        vector(input.embedding),
        input.topics ?? null,
        input.topK,
        input.embedding.length
      ]
    );
    return result.rows.map((row, index) => toHit(row, index + 1, 'semantic'));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
