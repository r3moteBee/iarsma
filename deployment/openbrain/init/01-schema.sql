-- Iarsma + OpenBrain co-deployment schema.
--
-- Adapted from the upstream OB1 self-hosted Kubernetes recipe:
--   https://github.com/NateBJones-Projects/OB1/blob/main/integrations/kubernetes-deployment/k8s/init.sql
--
-- The embedding dimension defaults to 768 to match the bundled Ollama
-- model (`nomic-embed-text`) so the recipe runs zero-API-key out of the
-- box. If you switch to OpenRouter/OpenAI embeddings (1536-dim) BEFORE
-- any rows land, swap this file for `01-schema-1536.sql.example` (see
-- the README), or run:
--
--   ALTER TABLE thoughts ALTER COLUMN embedding TYPE vector(1536);
--   -- ... then re-create the function below with vector(1536) signatures.
--
-- The OB1 server reads/writes whatever dimension the embedding API
-- returns; the table type just has to match.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS thoughts (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(768),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING GIN (metadata);

CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding vector(768),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 10,
    filter JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.content,
        t.metadata,
        (1 - (t.embedding <=> query_embedding))::FLOAT AS similarity,
        t.created_at
    FROM thoughts t
    WHERE 1 - (t.embedding <=> query_embedding) >= match_threshold
    ORDER BY t.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
