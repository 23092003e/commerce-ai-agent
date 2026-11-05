import { Pool } from 'pg';
import { loadConfig } from '../packages/config/src/index.js';
import { PostgresKnowledgeRepository } from '../packages/db/src/index.js';
import {
  createKnowledgeService,
  createOpenAiEmbeddingProvider
} from '../packages/domain/src/index.js';
import { parseReindexOptions, reindexKnowledge } from './reindex-runner.js';

const options = parseReindexOptions(process.argv.slice(2));
const config = loadConfig();
if (
  config.EMBEDDING_PROVIDER !== 'openai-compatible' ||
  !config.EMBEDDING_API_KEY ||
  !config.EMBEDDING_BASE_URL ||
  !config.EMBEDDING_MODEL
)
  throw new Error(
    'Reindex destination must be explicitly configured real embeddings'
  );
const repository = new PostgresKnowledgeRepository(config.DATABASE_URL);
const service = createKnowledgeService(
  repository,
  createOpenAiEmbeddingProvider({
    apiKey: config.EMBEDDING_API_KEY,
    baseUrl: config.EMBEDDING_BASE_URL,
    model: config.EMBEDDING_MODEL,
    dimensions: config.EMBEDDING_DIMENSIONS
  })
);
const pool = new Pool({ connectionString: config.DATABASE_URL });
interface SourceDocument {
  id: string;
  title: string;
  source_key: string;
  source_type: string;
  source_uri: string | null;
  topics: string[];
  content: string | null;
}
try {
  const result = await reindexKnowledge(options, {
    destinationProvider: config.EMBEDDING_PROVIDER,
    destinationModel: config.EMBEDDING_MODEL,
    async list(after, batchSize) {
      const rows = await pool.query<SourceDocument>(
        `SELECT id,title,source_key,source_type,source_uri,topics,normalized_content AS content FROM knowledge_documents WHERE status='active' AND embedding_provider=$1 AND ($2::text IS NULL OR embedding_model=$2) AND ($3::text='' OR id::text>$3) ORDER BY id LIMIT $4`,
        [options.sourceProvider, options.sourceModel ?? null, after, batchSize]
      );
      return rows.rows;
    },
    ingest(document) {
      return service.ingest({
        title: document.title,
        sourceKey: document.source_key,
        sourceType: document.source_type,
        ...(document.source_uri ? { sourceUri: document.source_uri } : {}),
        topics: document.topics,
        content: document.content
      });
    }
  });
  process.stdout.write(
    `${JSON.stringify({ mode: options.execute ? 'execute' : 'dry-run', ...result })}\n`
  );
} finally {
  await Promise.all([pool.end(), repository.close()]);
}
