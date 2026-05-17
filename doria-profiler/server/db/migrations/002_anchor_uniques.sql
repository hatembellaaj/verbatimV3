-- Migration 002 : contraintes d'unicité partielles sur les ancres.
-- Permet d'utiliser ON CONFLICT DO NOTHING lors de la sauvegarde répétée du même projet.
-- (text unique par cluster, idem par subcluster)

CREATE UNIQUE INDEX IF NOT EXISTS anchors_unique_cluster
    ON anchors (cluster_id, text)
    WHERE cluster_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS anchors_unique_subcluster
    ON anchors (subcluster_id, text)
    WHERE subcluster_id IS NOT NULL;
