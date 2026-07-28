-- Migration: Add tsvector column and GIN / Trigram indexes on markets.question

-- Enable pg_trgm extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add generated tsvector column for Full-Text Search
ALTER TABLE markets ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(question, ''))) STORED;

-- Create GIN index on tsvector column for fast FTS lookups
CREATE INDEX IF NOT EXISTS markets_search_vector_idx ON markets USING GIN (search_vector);

-- Create GIN trigram index on question column for fuzzy matching fallback
CREATE INDEX IF NOT EXISTS markets_question_trgm_idx ON markets USING GIN (question gin_trgm_ops);
