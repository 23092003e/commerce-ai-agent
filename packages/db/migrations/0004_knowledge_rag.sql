CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE knowledge_document_status AS ENUM ('active', 'archived');

CREATE TABLE knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source_type text NOT NULL,
  source_uri text,
  content_hash char(64) NOT NULL UNIQUE,
  status knowledge_document_status NOT NULL DEFAULT 'active',
  topics text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL,
  token_count integer NOT NULL CHECK (token_count > 0),
  section text,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  -- Phase 4 local/fake provider emits deterministic 8-dimensional vectors.
  -- Changing embedding models requires a forward migration and re-embedding.
  embedding vector(8) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX knowledge_chunks_fts_idx ON knowledge_chunks USING gin (fts);
CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX knowledge_chunks_document_idx ON knowledge_chunks (document_id, chunk_index);
CREATE INDEX knowledge_documents_topics_idx ON knowledge_documents USING gin (topics);

INSERT INTO knowledge_documents (title, source_type, content_hash, topics, metadata)
VALUES
  ('Demo shipping policy', 'policy', repeat('a', 64), ARRAY['shipping'], '{"demo":true}'::jsonb),
  ('Demo returns policy', 'policy', repeat('b', 64), ARRAY['returns'], '{"demo":true}'::jsonb),
  ('Demo payment policy', 'policy', repeat('c', 64), ARRAY['payment'], '{"demo":true}'::jsonb),
  ('Demo size guide', 'guide', repeat('d', 64), ARRAY['size'], '{"demo":true}'::jsonb),
  ('Demo warranty and care', 'guide', repeat('e', 64), ARRAY['warranty','care'], '{"demo":true}'::jsonb);

INSERT INTO knowledge_chunks (document_id, chunk_index, content, token_count, section, embedding, metadata)
SELECT id, 0,
  CASE title
    WHEN 'Demo shipping policy' THEN 'Demo shipping policy: orders arrive in two business days.'
    WHEN 'Demo returns policy' THEN 'Demo returns policy: unused items may be returned within seven days.'
    WHEN 'Demo payment policy' THEN 'Demo payment policy: demo store accepts cash on delivery and bank transfer.'
    WHEN 'Demo size guide' THEN 'Demo size guide: compare chest and waist measurements before choosing a size.'
    ELSE 'Demo warranty and care: keep items dry and follow the care label.'
  END,
  10,
  title,
  '[0,0,0,0,0,0,0,0]'::vector,
  '{"demo":true}'::jsonb
FROM knowledge_documents
WHERE metadata @> '{"demo":true}'::jsonb;
