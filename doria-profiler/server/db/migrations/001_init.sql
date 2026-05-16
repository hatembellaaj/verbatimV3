-- DORIA Profiler — schéma initial
-- Migration 001 : catégories, clusters/sous-clusters, ancres, projets, verbatims, classifications.
-- pgvector activé pour la colonne `embedding` (768 dim = Solon).
-- Le système de migration applique ce fichier UNE seule fois (table schema_migrations).

CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────
-- Catégorie = template métier (ex : "Parc d'attractions", "Restauration", ...)
-- Une catégorie regroupe ses clusters/sous-clusters et leurs ancres.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Cluster (niveau 1) — appartient à une catégorie.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clusters (
    id          SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(category_id, name)
);
CREATE INDEX IF NOT EXISTS clusters_category_idx ON clusters(category_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Sous-cluster (niveau 2) — appartient à un cluster.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subclusters (
    id          SERIAL PRIMARY KEY,
    cluster_id  INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(cluster_id, name)
);
CREATE INDEX IF NOT EXISTS subclusters_cluster_idx ON subclusters(cluster_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Ancres — phrases-exemples rattachées à un cluster OU à un sous-cluster.
-- scope_id = cluster_id OU subcluster_id selon scope.
-- source = 'llm' | 'manual' | 'correction'
-- embedding = vecteur Solon (768 dim), nullable (sera rempli par le service embed)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anchors (
    id            SERIAL PRIMARY KEY,
    cluster_id    INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
    subcluster_id INTEGER REFERENCES subclusters(id) ON DELETE CASCADE,
    text          TEXT NOT NULL,
    embedding     vector(768),
    source        TEXT NOT NULL CHECK (source IN ('llm', 'manual', 'correction')),
    project_id    INTEGER,  -- pour traçabilité (correction issue d'un projet)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (cluster_id IS NOT NULL OR subcluster_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS anchors_cluster_idx ON anchors(cluster_id);
CREATE INDEX IF NOT EXISTS anchors_subcluster_idx ON anchors(subcluster_id);
-- Index ivfflat pour la recherche par similarité cosinus (vide tant que peu d'ancres)
-- CREATE INDEX anchors_embedding_idx ON anchors USING ivfflat (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────────────────────────────────
-- Projet = une classification concrète sur un corpus.
-- taxo_snapshot = JSON figé de la taxo au moment du run (pour reproductibilité).
-- stats = distribution finale (compteurs, coverage, etc.).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id            SERIAL PRIMARY KEY,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    contexte      TEXT,
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'classified', 'archived')),
    mode          TEXT CHECK (mode IN ('llm', 'embed')),
    taxo_snapshot JSONB,
    stats         JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS projects_category_idx ON projects(category_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Verbatim = ligne du corpus client.
-- metadata = note, date, profil, source… (préserve l'origine CSV).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verbatims (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    external_id TEXT,
    text        TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS verbatims_project_idx ON verbatims(project_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Classifications — N par verbatim (multi-label).
-- source = 'auto' (sortie du classifier) | 'user_correction' (correction utilisateur)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS classifications (
    id                     SERIAL PRIMARY KEY,
    verbatim_id            INTEGER NOT NULL REFERENCES verbatims(id) ON DELETE CASCADE,
    cluster_id             INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
    subcluster_id          INTEGER REFERENCES subclusters(id) ON DELETE SET NULL,
    cluster_label          TEXT,
    subcluster_label       TEXT,
    confidence_cluster     REAL,
    confidence_subcluster  REAL,
    source                 TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'user_correction')),
    scores                 JSONB,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS classifications_verbatim_idx ON classifications(verbatim_id);
CREATE INDEX IF NOT EXISTS classifications_cluster_idx ON classifications(cluster_id);
