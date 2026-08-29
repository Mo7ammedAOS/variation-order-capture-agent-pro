-- pgvector: the extension, the columns Prisma cannot express, and the indexes.
--
-- Run AFTER `prisma migrate` has created the tables. Prisma has no vector type,
-- so the columns are declared `Unsupported(...)` in schema.prisma and created
-- here. Keep the dimension (384) in step with EMBEDDING_DIMS in
-- src/integrations/embeddings/provider.ts — a mismatch fails at insert time,
-- loudly, which is the good outcome.

CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW rather than IVFFlat: it needs no training pass, so it behaves correctly
-- on a table that starts empty and fills up, which is exactly a new deployment.
CREATE INDEX IF NOT EXISTS potential_change_embeddings_vector_idx
  ON potential_change_embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS document_chunks_vector_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Every similarity query filters by project_id BEFORE the ANN search. These
-- indexes are what make that filter cheap rather than a sequential scan.
CREATE INDEX IF NOT EXISTS potential_change_embeddings_project_idx
  ON potential_change_embeddings (project_id);

CREATE INDEX IF NOT EXISTS document_chunks_project_idx
  ON document_chunks (project_id);
