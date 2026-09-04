DROP INDEX knowledge_chunks_embedding_hnsw_idx;

ALTER TABLE knowledge_chunks
  ALTER COLUMN embedding TYPE vector USING embedding::vector;

ALTER TABLE knowledge_documents
  ADD COLUMN source_key text,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN embedding_dimensions integer NOT NULL DEFAULT 8
    CHECK (embedding_dimensions BETWEEN 2 AND 4096);

UPDATE knowledge_documents SET source_key = id::text WHERE source_key IS NULL;
ALTER TABLE knowledge_documents ALTER COLUMN source_key SET NOT NULL;
CREATE UNIQUE INDEX knowledge_documents_source_version_unique
  ON knowledge_documents (source_key, version);

CREATE INDEX knowledge_chunks_embedding_hnsw_8_idx
  ON knowledge_chunks USING hnsw ((embedding::vector(8)) vector_cosine_ops)
  WHERE vector_dims(embedding) = 8;
