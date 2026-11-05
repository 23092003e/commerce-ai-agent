ALTER TABLE knowledge_documents
  ADD COLUMN embedding_provider text NOT NULL DEFAULT 'deterministic',
  ADD COLUMN embedding_model text NOT NULL DEFAULT 'legacy-8d',
  ADD COLUMN normalized_content text;

-- Historical source cannot be reconstructed safely from overlapping chunks.
ALTER TABLE knowledge_documents DROP CONSTRAINT knowledge_documents_content_hash_key;
CREATE UNIQUE INDEX knowledge_documents_provenance_unique
  ON knowledge_documents (source_key, content_hash, embedding_provider, embedding_model, embedding_dimensions);

CREATE INDEX knowledge_chunks_embedding_hnsw_1536_idx
  ON knowledge_chunks USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WHERE vector_dims(embedding) = 1536;
